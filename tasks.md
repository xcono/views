## Architecture & Behavior Overview

The app tend to utilize high cohesion where "supabase response => (minimal mapping or no mapping) => shadcn component props" approach.

The application is a thin integration between a data layer (Supabase via supabase‑js) and a UI layer (shadcn‑svelte on SvelteKit). This is a **SPA (Single Page Application)** architecture with **direct data flow**: Supabase response data is passed directly to shadcn-svelte components via props without intermediate normalization. Direct data flow ensures proper field naming at the PostgREST level. A discovery‑driven preflight validates queries (tables/columns/operators/limits, RLS visibility) without heavy client‑side validators. The `QueryRunner` orchestrates preflight, policy checks, and execution via a Supabase `DataSource`, returning Supabase response format directly.

Operationally, the system is **SPA-only** and privacy‑aware: client creation is browser‑bound, secrets never leak to the browser, and only metadata (duration, row count, table name) is logged. Performance is safeguarded by strict limits and preview caps, and caching (optional) is a small in‑memory TTL keyed by a stable hash of the `QueryConfig`. All integration details must be verified against the `context7` docs for `huntabyte/shadcn-svelte` and `supabase/supabase-js`.

# Decomposition — Implementation Tasks (Aligned to plan.md)

Each task below is small enough for a coding LLM agent to implement in isolation. Agents MUST treat `context7` as the single source of truth for:

- `huntabyte/shadcn-svelte` (component APIs, props, accessibility, Svelte 5 integration)
- `supabase/supabase-js` (client creation, SPA architecture, PostgREST usage, errors)

For every task, agents must end with a checklist verification against `context7` docs for both libraries where relevant.

[DONE] ## Task 1 — Supabase Client Factory (SPA‑only)

Define a minimal client factory that creates a Supabase client using environment variables for **SPA (Single Page Application)** architecture. Ensure no secrets leak to the browser and that the anon key is used client‑side. Provide a tiny integration adapter surface that other modules import (not the raw SDK), to keep callsites stable if SDK APIs change.

- Constraints: no heavy validation libs; environment‑only secrets; log metadata only (never tokens/SQL); SPA-only architecture.
- Finish by verifying client creation guidance in `supabase/supabase-js` via `context7`.

[DONE] ## Task 2 — QueryConfig Types and Invariants (Discovery‑driven)

Create a typed `QueryConfig` for rest/sql kinds, including `from`, alias‑first `select`, `filters`, `orderBy`, `limit/offset`. Do not introduce Zod or similar; rely on discovery‑based invariants (see Task 3) to check that tables/columns/operators exist and are permitted. Keep types narrow but practical.

- Constraints: alias‑first is mandatory; strict caps for limit/preview.
- Finish by checking PostgREST select/filters/ordering semantics in `supabase/supabase-js` docs via `context7`.

[DONE] ## Task 3 — Schema Discovery Module (Supabase invariants)

Implement a module that reads table/view metadata (columns, types, nullability, constraints, FKs, indexes presence, RLS/policies visibility) for allow‑listed objects. Use this only for preflight, not for runtime data shaping. Cache lightweight metadata in memory with short TTL.

- Constraints: do not over‑fetch; avoid secrets in logs; respect RLS (surface policy errors clearly).
- Finish by verifying discovery approach against `supabase` meta/information‑schema guidance using `context7`.

[DONE] ## Task 4 — Preflight Validator (No heavy client validation)

Build a preflight validator that uses Task 3 metadata to validate `QueryConfig`: ensure `from` is allowed, columns exist, operators match types, and limits are within caps. Produce actionable, categorized errors (config, permission, transport, server/data) without leaking payloads.

- Constraints: no Zod; rely on discovery; preview limit must be stricter.
- Finish by confirming operator/type compatibility and error handling patterns in `supabase/supabase-js` via `context7`.

[DONE] ## Task 5 — DataSource (Supabase PostgREST/SQL)

Define `DataSource` interface and implement a Supabase version translating `QueryConfig` to PostgREST calls (and SQL/RPC if explicitly enabled). Normalize errors, enforce caps, and return arrays of aliased objects. Keep implementation thin and readable.

- Constraints: metadata‑only logging; SPA‑only client usage.
- Finish by checking query composition and error normalization practices in `supabase/supabase-js` via `context7`.

[DONE] ## Task 6 — UI Block Contracts (Table/Card/List/Chart)

Create thin wrapper components that receive Supabase data directly via props and pass it to shadcn‑svelte components. No data transformation inside components.

- Constraints: Use shadcn-svelte components as-is; leverage `QueryData<typeof query>` for TypeScript inference.
- Finish by verifying component prop expectations and a11y notes in `huntabyte/shadcn-svelte` via `context7`.

[DONE] ## Task 7 — QueryRunner

Create a `QueryRunner` that: runs preflight (Task 4), applies allow‑list policy, delegates to `DataSource`, and returns Supabase response format `{ data: T[], error: null | PostgrestError }` directly. Emit duration, row count, and table name only. Provide a single entrypoint consumed by UI and Designer.

- Constraints: no payload logging; return Supabase response format directly; deterministic behavior.
- Finish by verifying delegation patterns and pagination/limit guidance in `supabase/supabase-js` via `context7`.

[NEW] ## Task 8 — Centralized Error Helper

- Create `src/lib/views/errors.ts` with `toPostgrestError` to map internal/config/transport failures into `PostgrestError`.
- Replace ad-hoc conversions with this helper across data layer.
- Verify behavior against Supabase error shape.

[NEW] ## Task 9 — Optional Count Support (REST)

- Extend `RestQueryConfig` with `count?: 'exact' | 'planned' | 'estimated'`.
- Pass through to `.select(select, { count })` and include `count` only in metadata logs/UX.
- Keep default disabled.

[NEW] ## Task 10 — Friendly Operator Adapter (Designer Ergonomics)

- Add `src/lib/views/operators.ts` with `mapFriendlyFilter(s)` to translate UI-friendly operators to PostgREST ops/values.
- Use only at the UI/Designer layer; core DSL remains PostgREST-native.

[NEW] ## Task 11 — Live (Realtime) Helper

- Add `src/lib/views/live.ts` with `subscribeTable({ table, events, filter, onEvent })` returning an unsubscribe.
- Keep opt-in, separate from runner; no coupling to DataSource.

## Task 12 — Caching (Optional)

Introduce a small in‑memory TTL cache keyed by stable hash of `QueryConfig`. Define invalidation when any field changes; bypass cache on preview.

- Constraints: avoid staleness on policy changes; keep code minimal.
- Finish by checking pagination/limit behaviors and caching cautions in `supabase/supabase-js` via `context7`.

## Task 13 — Testing & Quality Gates

Add unit tests for alias helpers, preflight validator (discovery‑backed), data source translation, and runner behaviors. Add minimal component tests for blocks (render with valid data, error boundaries). Ensure format/lint/typecheck run green.

- Constraints: avoid snapshot brittleness; test observable behavior.
- Finish by verifying API usage against `huntabyte/shadcn-svelte` and `supabase/supabase-js` in `context7`.

## Task 14 — Documentation

Update README/architecture to reflect public contracts, discovery‑based validation approach, limits, and DoD. Include brief guidance on views/RPC for computed fields and RLS expectations.

- Constraints: no secrets; version notes included.
- Finish by cross‑checking referenced APIs against `context7` docs for both libraries.
