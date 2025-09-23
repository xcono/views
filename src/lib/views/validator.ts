// Preflight Validator (No heavy client validation)
// - Uses Task 3 metadata to validate QueryConfig
// - Ensures from is allowed, columns exist, operators match types, limits within caps
// - Produces actionable, categorized errors without leaking payloads
// - Discovery-driven validation without Zod or heavy client validators

import type { 
  QueryConfig, 
  RestQueryConfig, 
  SqlQueryConfig, 
  FilterOperator, 
  FilterSpec,
  OrderBySpec,
  QueryExecutionMode
} from "./query.js";
import { 
  QUERY_PREVIEW_LIMIT,
  QUERY_MAX_LIMIT,
  QUERY_DEFAULT_LIMIT
} from "./query.js";
import type { 
  TableMetadata, 
  ColumnMetadata, 
  DiscoveryResult, 
  DiscoveryError 
} from "./discovery.js";
import { discoverTableMetadata } from "./discovery.js";
import { isRestQueryConfig, isSqlQueryConfig, clampLimit } from "./query.js";

// Validation error types (aligned with discovery error types)
export type ValidationError = {
  type: "config" | "permission" | "transport" | "server";
  message: string;
  details?: Record<string, unknown>;
};

// Validation result
export type ValidationResult<T> = {
  success: true;
  data: T;
} | {
  success: false;
  error: ValidationError;
};

// Preflight validation context
export type PreflightContext = {
  mode: QueryExecutionMode;
  schemaName?: string;
};

// Column type families for operator compatibility
export type ColumnTypeFamily = 
  | "text" 
  | "numeric" 
  | "boolean" 
  | "temporal" 
  | "json" 
  | "uuid" 
  | "array"
  | "unknown";

// Operator compatibility matrix
const OPERATOR_COMPATIBILITY: Record<FilterOperator, ColumnTypeFamily[]> = {
  // Equality operators - work with most types
  "eq": ["text", "numeric", "boolean", "temporal", "uuid", "json"],
  "neq": ["text", "numeric", "boolean", "temporal", "uuid", "json"],
  "is": ["text", "numeric", "boolean", "temporal", "uuid", "json"],
  
  // Comparison operators - numeric and temporal only
  "gt": ["numeric", "temporal"],
  "gte": ["numeric", "temporal"],
  "lt": ["numeric", "temporal"],
  "lte": ["numeric", "temporal"],
  
  // Pattern matching - text only
  "like": ["text"],
  "ilike": ["text"],
  
  // Array operators - arrays and some text types
  "in": ["text", "numeric", "boolean", "temporal", "uuid"],
  "cs": ["array", "json"],
  "cd": ["array", "json"],
  
  // Range operators - numeric and temporal
  "sl": ["numeric", "temporal"],
  "sr": ["numeric", "temporal"],
  "nxl": ["numeric", "temporal"],
  "nxr": ["numeric", "temporal"],
  "adj": ["numeric", "temporal"],
  "ov": ["numeric", "temporal"],
  
  // Full-text search - text only
  "fts": ["text"],
  "plfts": ["text"],
  "phfts": ["text"],
  "wfts": ["text"]
};

/**
 * Maps PostgreSQL data types to type families
 */
function getColumnTypeFamily(dataType: string): ColumnTypeFamily {
  const type = dataType.toLowerCase();
  
  // Text types
  if (type.includes("text") || type.includes("varchar") || type.includes("char")) {
    return "text";
  }
  
  // Numeric types
  if (type.includes("int") || type.includes("numeric") || type.includes("decimal") || 
      type.includes("float") || type.includes("double") || type.includes("real")) {
    return "numeric";
  }
  
  // Boolean
  if (type.includes("bool")) {
    return "boolean";
  }
  
  // Temporal types
  if (type.includes("timestamp") || type.includes("date") || type.includes("time")) {
    return "temporal";
  }
  
  // UUID
  if (type.includes("uuid")) {
    return "uuid";
  }
  
  // JSON types
  if (type.includes("json")) {
    return "json";
  }
  
  // Array types
  if (type.includes("array") || type.includes("[]")) {
    return "array";
  }
  
  return "unknown";
}

/**
 * Validates if an operator is compatible with a column type
 */
function isOperatorCompatibleWithType(
  operator: FilterOperator, 
  columnType: string
): boolean {
  const typeFamily = getColumnTypeFamily(columnType);
  const compatibleTypes = OPERATOR_COMPATIBILITY[operator] || [];
  return compatibleTypes.includes(typeFamily);
}

/**
 * Validates if a filter value is compatible with a column type
 */
function isValueCompatibleWithType(value: unknown, columnType: string): boolean {
  const typeFamily = getColumnTypeFamily(columnType);
  
  switch (typeFamily) {
    case "text":
      return typeof value === "string";
    case "numeric":
      return typeof value === "number" && isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "temporal":
      return value instanceof Date || typeof value === "string";
    case "uuid":
      return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
    case "json":
      return typeof value === "object" || typeof value === "string";
    case "array":
      return Array.isArray(value);
    default:
      return true; // Unknown types - allow but warn
  }
}

/**
 * Validates alias-first select configuration
 */
function validateAliasFirstSelect(
  select: Record<string, string>,
  columns: ColumnMetadata[]
): ValidationError[] {
  const errors: ValidationError[] = [];
  const columnNames = columns.map(col => col.column_name);
  
  // Check for empty select
  if (Object.keys(select).length === 0) {
    errors.push({
      type: "config",
      message: "Select configuration cannot be empty",
      details: { select }
    });
    return errors;
  }
  
  // Validate each alias mapping
  for (const [alias, expression] of Object.entries(select)) {
    // Validate alias name
    if (!alias || typeof alias !== "string" || alias.trim() === "") {
      errors.push({
        type: "config",
        message: `Invalid alias name: "${alias}"`,
        details: { alias, expression }
      });
      continue;
    }
    
    // Validate expression
    if (!expression || typeof expression !== "string" || expression.trim() === "") {
      errors.push({
        type: "config",
        message: `Invalid expression for alias "${alias}": "${expression}"`,
        details: { alias, expression }
      });
      continue;
    }
    
    // For simple column references, check if column exists
    if (!expression.includes(".") && !expression.includes("(")) {
      if (!columnNames.includes(expression)) {
        errors.push({
          type: "config",
          message: `Column "${expression}" does not exist in table`,
          details: { alias, expression, availableColumns: columnNames }
        });
      }
    }
  }
  
  return errors;
}

/**
 * Validates filter specifications
 */
function validateFilters(
  filters: ReadonlyArray<FilterSpec>,
  columns: ColumnMetadata[]
): ValidationError[] {
  const errors: ValidationError[] = [];
  const columnMap = new Map(columns.map(col => [col.column_name, col]));
  
  for (const filter of filters) {
    const column = columnMap.get(filter.column);
    
    if (!column) {
      errors.push({
        type: "config",
        message: `Filter column "${filter.column}" does not exist`,
        details: { 
          filterColumn: filter.column, 
          availableColumns: columns.map(c => c.column_name) 
        }
      });
      continue;
    }
    
    // Check operator compatibility
    if (!isOperatorCompatibleWithType(filter.operator, column.data_type)) {
      errors.push({
        type: "config",
        message: `Operator "${filter.operator}" is not compatible with column type "${column.data_type}"`,
        details: { 
          operator: filter.operator, 
          columnType: column.data_type,
          columnName: filter.column
        }
      });
    }
    
    // Check value compatibility (skip for null checks)
    if (filter.operator !== "is" && !isValueCompatibleWithType(filter.value, column.data_type)) {
      errors.push({
        type: "config",
        message: `Filter value is not compatible with column type "${column.data_type}"`,
        details: { 
          value: typeof filter.value,
          columnType: column.data_type,
          columnName: filter.column,
          operator: filter.operator
        }
      });
    }
  }
  
  return errors;
}

/**
 * Validates order by specifications
 */
function validateOrderBy(
  orderBy: ReadonlyArray<OrderBySpec>,
  columns: ColumnMetadata[]
): ValidationError[] {
  const errors: ValidationError[] = [];
  const columnNames = columns.map(col => col.column_name);
  
  for (const order of orderBy) {
    if (!columnNames.includes(order.column)) {
      errors.push({
        type: "config",
        message: `Order by column "${order.column}" does not exist`,
        details: { 
          orderColumn: order.column, 
          availableColumns: columnNames 
        }
      });
    }
  }
  
  return errors;
}

/**
 * Validates limit and offset values
 */
function validatePagination(
  config: QueryConfig,
  mode: QueryExecutionMode
): ValidationError[] {
  const errors: ValidationError[] = [];
  
  // Validate limit
  if (config.limit !== undefined) {
    const effectiveLimit = clampLimit(config.limit, mode);
    const maxLimit = mode === "preview" ? QUERY_PREVIEW_LIMIT : QUERY_MAX_LIMIT;
    
    if (config.limit > maxLimit) {
      errors.push({
        type: "config",
        message: `Limit ${config.limit} exceeds maximum allowed ${maxLimit} for ${mode} mode`,
        details: { 
          requestedLimit: config.limit, 
          maxLimit, 
          mode,
          effectiveLimit 
        }
      });
    }
    
    if (config.limit < 1) {
      errors.push({
        type: "config",
        message: "Limit must be at least 1",
        details: { requestedLimit: config.limit }
      });
    }
  }
  
  // Validate offset
  if (config.offset !== undefined && config.offset < 0) {
    errors.push({
      type: "config",
      message: "Offset must be non-negative",
      details: { requestedOffset: config.offset }
    });
  }
  
  return errors;
}

/**
 * Validates SQL query configuration
 */
function validateSqlQuery(
  config: SqlQueryConfig,
  mode: QueryExecutionMode
): ValidationError[] {
  const errors: ValidationError[] = [];
  
  // Check for SELECT-only queries
  const sql = config.rawSql.trim().toLowerCase();
  if (!sql.startsWith("select")) {
    errors.push({
      type: "config",
      message: "SQL queries must be SELECT-only",
      details: { sql: config.rawSql.substring(0, 100) + "..." }
    });
  }
  
  // Check for dangerous keywords
  const dangerousKeywords = ["insert", "update", "delete", "drop", "create", "alter", "truncate"];
  for (const keyword of dangerousKeywords) {
    if (sql.includes(keyword)) {
      errors.push({
        type: "config",
        message: `SQL query contains forbidden keyword: "${keyword}"`,
        details: { keyword, sql: config.rawSql.substring(0, 100) + "..." }
      });
    }
  }
  
  // Validate pagination
  errors.push(...validatePagination(config, mode));
  
  return errors;
}

/**
 * Performs preflight validation on a QueryConfig
 */
export async function validateQueryConfig(
  config: QueryConfig,
  context: PreflightContext = { mode: "normal" }
): Promise<ValidationResult<TableMetadata>> {
  try {
    // Validate basic config structure
    if (!config || typeof config !== "object") {
      return {
        success: false,
        error: {
          type: "config",
          message: "QueryConfig must be a valid object",
          details: { config }
        }
      };
    }
    
    if (!config.kind || (config.kind !== "rest" && config.kind !== "sql")) {
      return {
        success: false,
        error: {
          type: "config",
          message: "QueryConfig must have a valid kind ('rest' or 'sql')",
          details: { kind: (config as any).kind }
        }
      };
    }
    
    // Handle SQL queries
    if (isSqlQueryConfig(config)) {
      const errors = validateSqlQuery(config, context.mode);
      if (errors.length > 0) {
        return {
          success: false,
          error: errors[0] // Return first error
        };
      }
      
      // SQL queries don't need table metadata
      return {
        success: true,
        data: {} as TableMetadata // Empty metadata for SQL queries
      };
    }
    
    // Handle REST queries
    if (isRestQueryConfig(config)) {
      // Discover table metadata
      const metadataResult = await discoverTableMetadata(
        config.from, 
        context.schemaName
      );
      
      if (!metadataResult.success) {
        return {
          success: false,
          error: {
            type: metadataResult.error.type,
            message: `Failed to discover table metadata: ${metadataResult.error.message}`,
            details: metadataResult.error.details
          }
        };
      }
      
      const metadata = metadataResult.data;
      const errors: ValidationError[] = [];
      
      // Validate alias-first select
      errors.push(...validateAliasFirstSelect(config.select, metadata.columns));
      
      // Validate filters
      if (config.filters) {
        errors.push(...validateFilters(config.filters, metadata.columns));
      }
      
      // Validate order by
      if (config.orderBy) {
        errors.push(...validateOrderBy(config.orderBy, metadata.columns));
      }
      
      // Validate pagination
      errors.push(...validatePagination(config, context.mode));
      
      // Check RLS policies if enabled
      if (metadata.has_rls_enabled && metadata.policies.length === 0) {
        errors.push({
          type: "permission",
          message: `Table "${config.from}" has RLS enabled but no policies defined`,
          details: { 
            tableName: config.from, 
            hasRlsEnabled: metadata.has_rls_enabled,
            policyCount: metadata.policies.length 
          }
        });
      }
      
      if (errors.length > 0) {
        return {
          success: false,
          error: errors[0] // Return first error
        };
      }
      
      return {
        success: true,
        data: metadata
      };
    }
    
    // This should never happen due to type guards
    return {
      success: false,
      error: {
        type: "config",
        message: "Invalid QueryConfig type",
        details: { config }
      }
    };
    
  } catch (err) {
    return {
      success: false,
      error: {
        type: "transport",
        message: "Unexpected error during validation",
        details: { 
          error: err instanceof Error ? err.message : "Unknown error",
          configKind: config.kind 
        }
      }
    };
  }
}

/**
 * Validates multiple QueryConfigs in batch
 */
export async function validateQueryConfigs(
  configs: QueryConfig[],
  context: PreflightContext = { mode: "normal" }
): Promise<ValidationResult<TableMetadata[]>> {
  try {
    const results = await Promise.all(
      configs.map(config => validateQueryConfig(config, context))
    );
    
    const failures = results.filter(result => !result.success);
    if (failures.length > 0) {
      return {
        success: false,
        error: (failures[0] as { success: false; error: ValidationError }).error
      };
    }
    
    const metadata = results.map(result => 
      (result as { success: true; data: TableMetadata }).data
    );
    
    return {
      success: true,
      data: metadata
    };
  } catch (err) {
    return {
      success: false,
      error: {
        type: "transport",
        message: "Unexpected error during batch validation",
        details: { 
          error: err instanceof Error ? err.message : "Unknown error",
          configCount: configs.length 
        }
      }
    };
  }
}

/**
 * Gets validation statistics for monitoring
 */
export function getValidationStats(): {
  operatorCompatibility: Record<string, number>;
  typeFamilies: Record<string, number>;
} {
  return {
    operatorCompatibility: Object.keys(OPERATOR_COMPATIBILITY).reduce((acc, op) => {
      acc[op] = OPERATOR_COMPATIBILITY[op as FilterOperator].length;
      return acc;
    }, {} as Record<string, number>),
    typeFamilies: {
      text: 1,
      numeric: 1,
      boolean: 1,
      temporal: 1,
      uuid: 1,
      json: 1,
      array: 1,
      unknown: 1
    }
  };
}
