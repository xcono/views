// QueryConfig types and small invariants (discovery-driven, no heavy validators)
// - Alias-first: select is alias -> source expression (PostgREST supports alias as `alias:col`)
// - Strict caps: default/max limits; preview has a stricter cap

export const QUERY_DEFAULT_LIMIT = 50 as const;
export const QUERY_MAX_LIMIT = 500 as const;
export const QUERY_PREVIEW_LIMIT = 20 as const;

export type QueryKind = "rest" | "sql";

// PostgREST filter operators (aligned with supabase-js filter helpers)
export type FilterOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "like"
  | "ilike"
  | "is"
  | "in"
  | "cs"
  | "cd"
  | "sl"
  | "sr"
  | "nxl"
  | "nxr"
  | "adj"
  | "ov"
  | "fts"
  | "plfts"
  | "phfts"
  | "wfts";

export type FilterSpec = {
  column: string;
  operator: FilterOperator;
  // Value is intentionally unknown here; discovery-driven validation will check type compatibility
  value: unknown;
};

export type OrderBySpec = {
  column: string;
  ascending?: boolean; // default true in executors
  // Optionally mirror supabase-js null handling; keep narrow and optional
  nulls?: "first" | "last";
};

// Alias-first select: key is the alias exposed to UI; value is the source column/expression
// Examples of value (PostgREST select fragment):
//   "title": "posts.title"
//   "author_name": "author.name"
//   "count": "count"
export type AliasFirstSelect = Record<string, string>;

export type BaseQueryConfig = {
  kind: QueryKind;
  // Enforced caps are applied by runner/validator; types exist here for ergonomics
  limit?: number;
  offset?: number;
};

export type RestQueryConfig = BaseQueryConfig & {
  kind: "rest";
  from: string; // table or view name
  select: AliasFirstSelect; // alias-first is mandatory
  filters?: ReadonlyArray<FilterSpec>;
  orderBy?: ReadonlyArray<OrderBySpec>;
};

export type SqlQueryConfig = BaseQueryConfig & {
  kind: "sql";
  // SELECT-only on client; discovery/preflight will enforce this
  rawSql: string;
  params?: ReadonlyArray<unknown>;
};

export type QueryConfig = RestQueryConfig | SqlQueryConfig;

export type QueryExecutionMode = "normal" | "preview";

// Small helpers (no network, no heavy validation)

export function clampLimit(
  requestedLimit: number | undefined,
  mode: QueryExecutionMode = "normal",
): number {
  const max = mode === "preview" ? QUERY_PREVIEW_LIMIT : QUERY_MAX_LIMIT;
  const fallback = mode === "preview" ? QUERY_PREVIEW_LIMIT : QUERY_DEFAULT_LIMIT;
  const n = typeof requestedLimit === "number" && isFinite(requestedLimit as number)
    ? Math.floor(requestedLimit as number)
    : fallback;
  if (n < 1) return 1;
  if (n > max) return max;
  return n;
}

export function clampOffset(requestedOffset: number | undefined): number {
  const n = typeof requestedOffset === "number" && isFinite(requestedOffset as number)
    ? Math.floor(requestedOffset as number)
    : 0;
  return n < 0 ? 0 : n;
}

export function isAliasFirstSelectValid(select: AliasFirstSelect): boolean {
  // Aliases must be non-empty unique keys; values must be non-empty strings
  const aliases = Object.keys(select);
  if (aliases.length === 0) return false;
  const seen: { [alias: string]: true } = {};
  for (let i = 0; i < aliases.length; i++) {
    const alias = aliases[i];
    if (!alias || typeof alias !== "string") return false;
    if (seen[alias]) return false;
    seen[alias] = true;
    const expr = select[alias];
    if (!expr || typeof expr !== "string") return false;
  }
  return true;
}

export function isRestQueryConfig(config: QueryConfig): config is RestQueryConfig {
  return config.kind === "rest";
}

export function isSqlQueryConfig(config: QueryConfig): config is SqlQueryConfig {
  return config.kind === "sql";
}

// Compute effective pagination bounds without mutating the original config
export function getEffectiveLimit(
  config: QueryConfig,
  mode: QueryExecutionMode = "normal",
): number {
  return clampLimit(config.limit, mode);
}

export function getEffectiveOffset(config: QueryConfig): number {
  return clampOffset(config.offset);
}


