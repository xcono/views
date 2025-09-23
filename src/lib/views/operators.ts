import type { FilterSpec } from "./query.js";

export type FriendlyOperator =
  | "contains"
  | "icontains"
  | "startsWith"
  | "istartsWith"
  | "endsWith"
  | "iendsWith"
  | "between";

export type FriendlyFilter = {
  column: string;
  op: FriendlyOperator;
  value: unknown;
};

export function mapFriendlyFilter(filter: FriendlyFilter): FilterSpec[] {
  const { column, op, value } = filter;
  switch (op) {
    case "contains":
      return [{ column, operator: "like", value: `%${value}%` }];
    case "icontains":
      return [{ column, operator: "ilike", value: `%${value}%` }];
    case "startsWith":
      return [{ column, operator: "like", value: `${value}%` }];
    case "istartsWith":
      return [{ column, operator: "ilike", value: `${value}%` }];
    case "endsWith":
      return [{ column, operator: "like", value: `%${value}` }];
    case "iendsWith":
      return [{ column, operator: "ilike", value: `%${value}` }];
    case "between": {
      if (!Array.isArray(value) || value.length !== 2) {
        throw new Error("'between' expects a two-element array [min, max]");
      }
      const [min, max] = value as [unknown, unknown];
      return [
        { column, operator: "gte", value: min },
        { column, operator: "lte", value: max },
      ];
    }
    default:
      return [];
  }
}

export function mapFriendlyFilters(filters: FriendlyFilter[]): FilterSpec[] {
  const out: FilterSpec[] = [];
  for (const f of filters) {
    out.push(...mapFriendlyFilter(f));
  }
  return out;
}
