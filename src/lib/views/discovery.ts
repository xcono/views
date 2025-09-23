// Schema Discovery Module (Supabase invariants)
// - Reads table/view metadata for allow-listed objects only
// - Uses information_schema queries for discovery-driven validation
// - Caches lightweight metadata in memory with short TTL
// - Respects RLS and surfaces policy errors clearly
//
// NOTE: This implementation uses client.rpc("exec_sql", ...) which requires
// a custom SQL function to be created in Supabase. For production use,
// consider creating a dedicated RPC function or using direct table queries
// where information_schema tables are accessible via PostgREST.

import { supabase } from "./factory.js";

// Cache configuration
const DISCOVERY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DISCOVERY_CACHE_MAX_SIZE = 100; // Prevent memory bloat

// Cache entry with TTL
type CacheEntry<T> = {
  data: T;
  timestamp: number;
};

// In-memory cache for schema metadata
class DiscoveryCache {
  private cache = new Map<string, CacheEntry<any>>();

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    const now = Date.now();
    if (now - entry.timestamp > DISCOVERY_CACHE_TTL_MS) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.data as T;
  }

  set<T>(key: string, data: T): void {
    // Enforce cache size limit
    if (this.cache.size >= DISCOVERY_CACHE_MAX_SIZE) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  clear(): void {
    this.cache.clear();
  }
}

// Column metadata from information_schema
export type ColumnMetadata = {
  column_name: string;
  data_type: string;
  is_nullable: boolean;
  column_default: string | null;
  character_maximum_length: number | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
};

// Constraint metadata
export type ConstraintMetadata = {
  constraint_name: string;
  constraint_type: "PRIMARY KEY" | "UNIQUE" | "FOREIGN KEY" | "CHECK";
  column_name: string;
  foreign_table_name?: string;
  foreign_column_name?: string;
};

// Index metadata
export type IndexMetadata = {
  index_name: string;
  index_definition: string;
  is_unique: boolean;
  column_names: string[];
};

// RLS policy metadata
export type PolicyMetadata = {
  policy_name: string;
  permissive: boolean;
  roles: string[];
  cmd: string;
  qual: string | null;
  with_check: string | null;
};

// Complete table/view metadata
export type TableMetadata = {
  table_name: string;
  table_type: "BASE TABLE" | "VIEW";
  columns: ColumnMetadata[];
  constraints: ConstraintMetadata[];
  indexes: IndexMetadata[];
  policies: PolicyMetadata[];
  has_rls_enabled: boolean;
};

// Discovery error types
export type DiscoveryError = {
  type: "config" | "permission" | "transport" | "server";
  message: string;
  details?: Record<string, unknown>;
};

// Discovery result
export type DiscoveryResult<T> = {
  success: true;
  data: T;
} | {
  success: false;
  error: DiscoveryError;
};

// Global cache instance
const discoveryCache = new DiscoveryCache();

// Allow-list configuration (should be configurable in production)
const ALLOWED_SCHEMAS = ["public"] as const;
const ALLOWED_TABLE_PATTERNS = [/^[a-zA-Z_][a-zA-Z0-9_]*$/] as const;

/**
 * Validates if a table name is allowed for discovery
 */
function isTableAllowed(tableName: string): boolean {
  if (!tableName || typeof tableName !== "string") return false;
  
  return ALLOWED_TABLE_PATTERNS.some(pattern => pattern.test(tableName));
}

/**
 * Gets column metadata for a table/view
 */
async function getColumnMetadata(
  tableName: string,
  schemaName: string = "public"
): Promise<DiscoveryResult<ColumnMetadata[]>> {
  try {
    const client = supabase.getClient();
    
    const { data, error } = await client.rpc("exec_sql", {
      sql: `
        SELECT 
          column_name,
          data_type,
          is_nullable,
          column_default,
          character_maximum_length,
          numeric_precision,
          numeric_scale
        FROM information_schema.columns 
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position
      `,
      params: [schemaName, tableName]
    });

    if (error) {
      return {
        success: false,
        error: {
          type: "server",
          message: `Failed to fetch column metadata for ${tableName}`,
          details: { tableName, schemaName, error: error.message }
        }
      };
    }

    return {
      success: true,
      data: data || []
    };
  } catch (err) {
    return {
      success: false,
      error: {
        type: "transport",
        message: `Network error while fetching column metadata`,
        details: { tableName, schemaName }
      }
    };
  }
}

/**
 * Gets constraint metadata for a table/view
 */
async function getConstraintMetadata(
  tableName: string,
  schemaName: string = "public"
): Promise<DiscoveryResult<ConstraintMetadata[]>> {
  try {
    const client = supabase.getClient();
    
    const { data, error } = await client.rpc("exec_sql", {
      sql: `
        SELECT 
          tc.constraint_name,
          tc.constraint_type,
          kcu.column_name,
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name
        FROM information_schema.table_constraints tc
        LEFT JOIN information_schema.key_column_usage kcu 
          ON tc.constraint_name = kcu.constraint_name
        LEFT JOIN information_schema.constraint_column_usage ccu 
          ON tc.constraint_name = ccu.constraint_name
        WHERE tc.table_schema = $1 AND tc.table_name = $2
        ORDER BY tc.constraint_name, kcu.ordinal_position
      `,
      params: [schemaName, tableName]
    });

    if (error) {
      return {
        success: false,
        error: {
          type: "server",
          message: `Failed to fetch constraint metadata for ${tableName}`,
          details: { tableName, schemaName, error: error.message }
        }
      };
    }

    return {
      success: true,
      data: data || []
    };
  } catch (err) {
    return {
      success: false,
      error: {
        type: "transport",
        message: `Network error while fetching constraint metadata`,
        details: { tableName, schemaName }
      }
    };
  }
}

/**
 * Gets index metadata for a table/view
 */
async function getIndexMetadata(
  tableName: string,
  schemaName: string = "public"
): Promise<DiscoveryResult<IndexMetadata[]>> {
  try {
    const client = supabase.getClient();
    
    const { data, error } = await client.rpc("exec_sql", {
      sql: `
        SELECT 
          i.indexname as index_name,
          i.indexdef as index_definition,
          i.indexdef LIKE '%UNIQUE%' as is_unique,
          array_agg(a.attname ORDER BY a.attnum) as column_names
        FROM pg_indexes i
        LEFT JOIN pg_class c ON c.relname = i.tablename
        LEFT JOIN pg_index idx ON idx.indexrelid = (i.schemaname||'.'||i.indexname)::regclass
        LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(idx.indkey)
        WHERE i.schemaname = $1 AND i.tablename = $2
        GROUP BY i.indexname, i.indexdef
        ORDER BY i.indexname
      `,
      params: [schemaName, tableName]
    });

    if (error) {
      return {
        success: false,
        error: {
          type: "server",
          message: `Failed to fetch index metadata for ${tableName}`,
          details: { tableName, schemaName, error: error.message }
        }
      };
    }

    return {
      success: true,
      data: data || []
    };
  } catch (err) {
    return {
      success: false,
      error: {
        type: "transport",
        message: `Network error while fetching index metadata`,
        details: { tableName, schemaName }
      }
    };
  }
}

/**
 * Gets RLS policy metadata for a table/view
 */
async function getPolicyMetadata(
  tableName: string,
  schemaName: string = "public"
): Promise<DiscoveryResult<PolicyMetadata[]>> {
  try {
    const client = supabase.getClient();
    
    const { data, error } = await client.rpc("exec_sql", {
      sql: `
        SELECT 
          policyname as policy_name,
          permissive,
          roles,
          cmd,
          qual,
          with_check
        FROM pg_policies
        WHERE schemaname = $1 AND tablename = $2
        ORDER BY policyname
      `,
      params: [schemaName, tableName]
    });

    if (error) {
      return {
        success: false,
        error: {
          type: "server",
          message: `Failed to fetch policy metadata for ${tableName}`,
          details: { tableName, schemaName, error: error.message }
        }
      };
    }

    return {
      success: true,
      data: data || []
    };
  } catch (err) {
    return {
      success: false,
      error: {
        type: "transport",
        message: `Network error while fetching policy metadata`,
        details: { tableName, schemaName }
      }
    };
  }
}

/**
 * Checks if RLS is enabled for a table/view
 */
async function isRlsEnabled(
  tableName: string,
  schemaName: string = "public"
): Promise<DiscoveryResult<boolean>> {
  try {
    const client = supabase.getClient();
    
    const { data, error } = await client.rpc("exec_sql", {
      sql: `
        SELECT relrowsecurity as has_rls_enabled
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = $2
      `,
      params: [schemaName, tableName]
    });

    if (error) {
      return {
        success: false,
        error: {
          type: "server",
          message: `Failed to check RLS status for ${tableName}`,
          details: { tableName, schemaName, error: error.message }
        }
      };
    }

    return {
      success: true,
      data: data?.[0]?.has_rls_enabled || false
    };
  } catch (err) {
    return {
      success: false,
      error: {
        type: "transport",
        message: `Network error while checking RLS status`,
        details: { tableName, schemaName }
      }
    };
  }
}

/**
 * Gets table type (BASE TABLE or VIEW)
 */
async function getTableType(
  tableName: string,
  schemaName: string = "public"
): Promise<DiscoveryResult<"BASE TABLE" | "VIEW">> {
  try {
    const client = supabase.getClient();
    
    const { data, error } = await client.rpc("exec_sql", {
      sql: `
        SELECT table_type
        FROM information_schema.tables
        WHERE table_schema = $1 AND table_name = $2
      `,
      params: [schemaName, tableName]
    });

    if (error) {
      return {
        success: false,
        error: {
          type: "server",
          message: `Failed to get table type for ${tableName}`,
          details: { tableName, schemaName, error: error.message }
        }
      };
    }

    if (!data || data.length === 0) {
      return {
        success: false,
        error: {
          type: "config",
          message: `Table or view '${tableName}' not found in schema '${schemaName}'`,
          details: { tableName, schemaName }
        }
      };
    }

    return {
      success: true,
      data: data[0].table_type
    };
  } catch (err) {
    return {
      success: false,
      error: {
        type: "transport",
        message: `Network error while getting table type`,
        details: { tableName, schemaName }
      }
    };
  }
}

/**
 * Discovers complete metadata for a table or view
 * Uses caching to avoid redundant queries
 */
export async function discoverTableMetadata(
  tableName: string,
  schemaName: string = "public"
): Promise<DiscoveryResult<TableMetadata>> {
  // Validate table name
  if (!isTableAllowed(tableName)) {
    return {
      success: false,
      error: {
        type: "config",
        message: `Table name '${tableName}' is not allowed`,
        details: { tableName, schemaName }
      }
    };
  }

  // Check cache first
  const cacheKey = `table_metadata:${schemaName}:${tableName}`;
  const cached = discoveryCache.get<TableMetadata>(cacheKey);
  if (cached) {
    return { success: true, data: cached };
  }

  try {
    // Fetch all metadata in parallel
    const [
      tableTypeResult,
      columnsResult,
      constraintsResult,
      indexesResult,
      policiesResult,
      rlsResult
    ] = await Promise.all([
      getTableType(tableName, schemaName),
      getColumnMetadata(tableName, schemaName),
      getConstraintMetadata(tableName, schemaName),
      getIndexMetadata(tableName, schemaName),
      getPolicyMetadata(tableName, schemaName),
      isRlsEnabled(tableName, schemaName)
    ]);

    // Check for any failures
    const failures = [
      tableTypeResult,
      columnsResult,
      constraintsResult,
      indexesResult,
      policiesResult,
      rlsResult
    ].filter(result => !result.success);

    if (failures.length > 0) {
      // Return the first failure
      return failures[0] as DiscoveryResult<TableMetadata>;
    }

    // Combine all metadata (we know all results are successful at this point)
    const metadata: TableMetadata = {
      table_name: tableName,
      table_type: (tableTypeResult as { success: true; data: "BASE TABLE" | "VIEW" }).data,
      columns: (columnsResult as { success: true; data: ColumnMetadata[] }).data,
      constraints: (constraintsResult as { success: true; data: ConstraintMetadata[] }).data,
      indexes: (indexesResult as { success: true; data: IndexMetadata[] }).data,
      policies: (policiesResult as { success: true; data: PolicyMetadata[] }).data,
      has_rls_enabled: (rlsResult as { success: true; data: boolean }).data
    };

    // Cache the result
    discoveryCache.set(cacheKey, metadata);

    return {
      success: true,
      data: metadata
    };
  } catch (err) {
    return {
      success: false,
      error: {
        type: "transport",
        message: `Unexpected error during metadata discovery`,
        details: { tableName, schemaName }
      }
    };
  }
}

/**
 * Lists all available tables and views in allowed schemas
 */
export async function listAvailableTables(
  schemaName: string = "public"
): Promise<DiscoveryResult<string[]>> {
  const cacheKey = `available_tables:${schemaName}`;
  const cached = discoveryCache.get<string[]>(cacheKey);
  if (cached) {
    return { success: true, data: cached };
  }

  try {
    const client = supabase.getClient();
    
    const { data, error } = await client.rpc("exec_sql", {
      sql: `
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = $1
        ORDER BY table_name
      `,
      params: [schemaName]
    });

    if (error) {
      return {
        success: false,
        error: {
          type: "server",
          message: `Failed to list tables in schema '${schemaName}'`,
          details: { schemaName, error: error.message }
        }
      };
    }

    const tableNames = (data || [])
      .map((row: any) => row.table_name)
      .filter((name: string) => isTableAllowed(name));

    // Cache the result
    discoveryCache.set(cacheKey, tableNames);

    return {
      success: true,
      data: tableNames
    };
  } catch (err) {
    return {
      success: false,
      error: {
        type: "transport",
        message: `Network error while listing tables`,
        details: { schemaName }
      }
    };
  }
}

/**
 * Clears the discovery cache
 */
export function clearDiscoveryCache(): void {
  discoveryCache.clear();
}

/**
 * Gets cache statistics for monitoring
 */
export function getCacheStats(): {
  size: number;
  maxSize: number;
  ttlMs: number;
} {
  return {
    size: discoveryCache["cache"].size,
    maxSize: DISCOVERY_CACHE_MAX_SIZE,
    ttlMs: DISCOVERY_CACHE_TTL_MS
  };
}
