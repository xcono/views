// DataSource interface and Supabase implementations
// - Follows official PostgREST documentation patterns
// - Uses proper supabase-js client methods
// - Implements alias-first select with PostgREST syntax
// - Normalizes errors and enforces limits

import { supabase } from "./factory.js";
import type { 
  QueryConfig, 
  RestQueryConfig, 
  SqlQueryConfig,
  FilterSpec,
  OrderBySpec,
  QueryExecutionMode
} from "./query.js";
import { 
  getEffectiveLimit, 
  getEffectiveOffset,
  isRestQueryConfig,
  isSqlQueryConfig 
} from "./query.js";
import { validateQueryConfig } from "./validator.js";
import type { PostgrestError } from "@supabase/supabase-js";
import { toPostgrestError } from "./errors.js";

// DataSource execution result - align with Supabase response format
export type DataSourceResult<T = unknown> = {
  data: T[] | null;
  error: PostgrestError | null;
};

// DataSource interface
export interface DataSource {
  execute<T = unknown>(
    config: QueryConfig,
    mode?: QueryExecutionMode
  ): Promise<DataSourceResult<T>>;
}

/**
 * Supabase REST DataSource implementation
 * Uses PostgREST API via supabase-js client
 */
export class SupabaseRestSource implements DataSource {
  async execute<T = unknown>(
    config: RestQueryConfig,
    mode: QueryExecutionMode = "normal"
  ): Promise<DataSourceResult<T>> {
    const startTime = Date.now();
    
    try {
      const client = supabase.getClient();
      
      // Build alias-first select string
      const selectString = this.buildSelectString(config.select);
      
      // Start query builder
      let query = client
        .from(config.from)
        .select(selectString, { count: config.count });
      
      // Apply filters
      if (config.filters && config.filters.length > 0) {
        query = this.applyFilters(query, config.filters);
      }
      
      // Apply ordering
      if (config.orderBy && config.orderBy.length > 0) {
        query = this.applyOrderBy(query, config.orderBy);
      }
      
      // Apply pagination
      const limit = getEffectiveLimit(config, mode);
      const offset = getEffectiveOffset(config);
      
      if (limit > 0) {
        query = query.range(offset, offset + limit - 1);
      }
      
      // Execute query
      const { data, error, count } = await query;
      
      const duration = Date.now() - startTime;
      // Emit metadata only (no payload)
      try {
        // eslint-disable-next-line no-console
        console.debug("[Query] REST", {
          table: config.from,
          rowCount: data?.length ?? 0,
          totalCount: count ?? undefined,
          durationMs: duration
        });
      } catch {}
      
      if (error) {
        return { data: null, error };
      }
      
      return { data: (data || []) as T[], error: null };
      
    } catch (err) {
      const duration = Date.now() - startTime;
      try {
        // eslint-disable-next-line no-console
        console.debug("[Query] REST error", {
          table: config.from,
          rowCount: 0,
          durationMs: duration
        });
      } catch {}
      
      return {
        data: null,
        error: toPostgrestError({
          message: "Network error during query execution",
          details: err instanceof Error ? err.message : "Unknown error",
          hint: "transport",
          code: "TRANSPORT"
        })
      };
    }
  }
  
  /**
   * Builds PostgREST select string from alias-first mapping
   * Example: { "title": "posts.title", "author": "author.name" } -> "title:posts.title,author:author.name"
   */
  private buildSelectString(select: Record<string, string>): string {
    return Object.entries(select)
      .map(([alias, expression]) => `${alias}:${expression}`)
      .join(",");
  }
  
  /**
   * Applies filters to the query using PostgREST operators
   */
  private applyFilters(query: any, filters: ReadonlyArray<FilterSpec>) {
    for (const filter of filters) {
      switch (filter.operator) {
        case "eq":
          query = query.eq(filter.column, filter.value);
          break;
        case "neq":
          query = query.neq(filter.column, filter.value);
          break;
        case "gt":
          query = query.gt(filter.column, filter.value);
          break;
        case "gte":
          query = query.gte(filter.column, filter.value);
          break;
        case "lt":
          query = query.lt(filter.column, filter.value);
          break;
        case "lte":
          query = query.lte(filter.column, filter.value);
          break;
        case "like":
          query = query.like(filter.column, filter.value as string);
          break;
        case "ilike":
          query = query.ilike(filter.column, filter.value as string);
          break;
        case "is":
          query = query.is(filter.column, filter.value);
          break;
        case "in":
          query = query.in(filter.column, filter.value as unknown[]);
          break;
        case "cs":
          query = query.cs(filter.column, filter.value);
          break;
        case "cd":
          query = query.cd(filter.column, filter.value);
          break;
        case "sl":
          query = query.sl(filter.column, filter.value);
          break;
        case "sr":
          query = query.sr(filter.column, filter.value);
          break;
        case "nxl":
          query = query.nxl(filter.column, filter.value);
          break;
        case "nxr":
          query = query.nxr(filter.column, filter.value);
          break;
        case "adj":
          query = query.adj(filter.column, filter.value);
          break;
        case "ov":
          query = query.ov(filter.column, filter.value);
          break;
        case "fts":
          query = query.textSearch(filter.column, filter.value as string);
          break;
        case "plfts":
          query = query.textSearch(filter.column, filter.value as string, { type: "phrase" });
          break;
        case "phfts":
          query = query.textSearch(filter.column, filter.value as string, { type: "phrase", config: "english" });
          break;
        case "wfts":
          query = query.textSearch(filter.column, filter.value as string, { type: "websearch" });
          break;
        default:
          // Use generic filter method for unsupported operators
          query = query.filter(filter.column, filter.operator, filter.value);
      }
    }
    
    return query;
  }
  
  /**
   * Applies ordering to the query
   */
  private applyOrderBy(query: any, orderBy: ReadonlyArray<OrderBySpec>) {
    for (const order of orderBy) {
      query = query.order(order.column, {
        ascending: order.ascending ?? true,
        nullsFirst: order.nulls === "first"
      });
    }
    
    return query;
  }
}

/**
 * Supabase SQL DataSource implementation
 * Uses SQL API via supabase-js client (SELECT-only)
 */
export class SupabaseSqlSource implements DataSource {
  async execute<T = unknown>(
    config: SqlQueryConfig,
    mode: QueryExecutionMode = "normal"
  ): Promise<DataSourceResult<T>> {
    const startTime = Date.now();
    
    try {
      const client = supabase.getClient();
      
      // Execute SQL query
      const { data, error } = await client.rpc("exec_sql", {
        sql: config.rawSql,
        params: config.params || []
      });
      
      const duration = Date.now() - startTime;
      try {
        // eslint-disable-next-line no-console
        console.debug("[Query] SQL", {
          table: "sql_query",
          rowCount: data?.length ?? 0,
          durationMs: duration
        });
      } catch {}
      
      if (error) {
        return { data: null, error };
      }
      
      return { data: (data || []) as T[], error: null };
      
    } catch (err) {
      const duration = Date.now() - startTime;
      try {
        // eslint-disable-next-line no-console
        console.debug("[Query] SQL error", {
          table: "sql_query",
          rowCount: 0,
          durationMs: duration
        });
      } catch {}
      
      return {
        data: null,
        error: toPostgrestError({
          message: "Network error during SQL execution",
          details: err instanceof Error ? err.message : "Unknown error",
          hint: "transport",
          code: "TRANSPORT"
        })
      };
    }
  }
}

/**
 * QueryRunner - orchestrates preflight, validation, and execution
 */
export class QueryRunner implements DataSource {
  private restSource = new SupabaseRestSource();
  private sqlSource = new SupabaseSqlSource();
  
  async execute<T = unknown>(
    config: QueryConfig,
    mode: QueryExecutionMode = "normal"
  ): Promise<DataSourceResult<T>> {
    const startTime = Date.now();

    // Preflight validation (includes allow-list via discovery)
    const validation = await validateQueryConfig(config, { mode });
    if (!validation.success) {
      const durationMs = Date.now() - startTime;
      try {
        // eslint-disable-next-line no-console
        console.debug("[QueryRunner] validation failed", {
          table: isRestQueryConfig(config) ? config.from : "sql_query",
          durationMs
        });
      } catch {}

      return {
        data: null,
        error: toPostgrestError({
          message: validation.error.message,
          details: validation.error.details,
          hint: validation.error.type,
          code: (validation.error.type || "config").toUpperCase()
        })
      };
    }
    
    // Delegate to appropriate source
    const result = isRestQueryConfig(config)
      ? await this.restSource.execute<T>(config, mode)
      : isSqlQueryConfig(config)
        ? await this.sqlSource.execute<T>(config, mode)
        : { data: null, error: toPostgrestError({ message: "Invalid query configuration", code: "CONFIG" }) };

    // Emit metadata only
    try {
      // eslint-disable-next-line no-console
      console.debug("[QueryRunner] executed", {
        table: isRestQueryConfig(config) ? config.from : "sql_query",
        rowCount: result.data?.length ?? 0,
        durationMs: Date.now() - startTime
      });
    } catch {}

    return result;
  }
}

// Default instance
export const queryRunner = new QueryRunner();
