# Technical Specification — Integration Layer for Supabase × SvelteKit × shadcn‑svelte (Alias‑First)

This document defines goals, architectural contracts, and acceptance criteria for a thin, verifiable integration layer between a data source (Supabase) and UI components (shadcn‑svelte) within a SvelteKit application. The specification emphasizes stability, replaceability, and verifiability. Concrete code examples are intentionally omitted.

---

## 1. Purpose and Scope

- **Objective**: Provide a minimal, stable integration layer that enables composing pages from UI blocks backed by configurable data queries, using direct data flow from Supabase to shadcn-svelte components.
- **Direct Data Flow Principle**: Supabase responses are passed directly to UI components without intermediate normalization. Alias-first select ensures proper field naming at the PostgREST level.
- **Out of Scope**: Building a complex UI framework, designing a custom ORM/DSL beyond a small declarative query shape, or moving business logic to the client.
- **Constraints**: Secrets are environment‑only; client executes read‑safe operations; **SPA (Single Page Application)** architecture only.

---

## 2. Principles and Non‑Goals

- **Integration‑first**: Prefer mature libraries and thin adapters over bespoke abstractions.
- **Simplicity over cleverness**: Small, explicit interfaces; shallow dependency graph.
- **Stability**: Pin versions; avoid churn; document public contracts.
- **Verifiability**: Declarative configs, preflight checks, deterministic rendering.
- **Security**: Never leak secrets; respect RLS and policies; log metadata only.

Non‑goals include: creating a new visual framework, duplicating database logic in the client, or implementing heavy client validation libraries at this stage.

---

## 3. Tech Stack and Quality Gates

- **Platform**: SvelteKit 2.x (Svelte 5), TypeScript 5.x, **SPA mode only**.
- **UI**: Tailwind CSS, shadcn‑svelte (align with `huntabyte/shadcn-svelte` component interfaces and patterns).
- **Data**: supabase‑js 2.x for PostgREST/SQL/RPC; follow client creation, **SPA architecture**, and error handling recommendations.
- **Quality**: ESLint, Prettier, svelte‑check, Vitest (+ Testing Library). All gates must be green pre‑merge.
- **Versioning**: Pin dependency versions; evolve contracts via explicit versioning.

---

## 4. Architecture Overview

### 4.1 Layers
- **Data Integration Layer**: Declarative QueryConfig, preflight validation, DataSource executor, QueryRunner, optional cache.
- **UI Layer**: shadcn-svelte components that receive Supabase data directly via props; no data transformation inside components.
- **Designer**: Query builder UI, alias mapping, preview, canvas management.

### 4.2 Stability Contracts
- **Direct data flow**: UI components receive Supabase response data directly via props.
- **Small, explicit interfaces**: Single‑responsibility modules; typed contracts.
- **Determinism**: Serializable configs, predictable rendering, no hidden transforms.
- **Type safety**: Leverage `QueryData<typeof query>` for automatic TypeScript inference.

---

## 5. Data Layer Specification

### 5.1 Declarative QueryConfig
- **Shape**: A typed object describing source kind (e.g., `rest` or `sql` when applicable), target table/view, alias‑first `select`, filters, ordering, and pagination.
- **Rules**:
  - Aliases are required for all fields consumed by the UI blocks.
  - Client executes read‑safe operations only; computed fields are produced in the database (views or RPC).
  - Enforce strict row limits and protect previews from accidental scans.
  - Perform preflight checks before execution; surface actionable, user‑friendly errors.
  - Optional: `count` hint (`exact` | `planned` | `estimated`) for REST queries to request PostgREST counts; default is disabled to avoid overhead.

### 5.2 Supabase‑Driven Schema Invariants (Discovery‑Based Validation)
- **No heavy client‑side validation**: Do not introduce Zod or similar at this stage. Validation relies on Supabase schema discovery and database invariants.
- **Discovery Source**: Use Supabase metadata/introspection (e.g., information schema or Supabase meta APIs) to fetch the following invariants for the selected table/view:
  - Existence of table/view and allow‑listed status.
  - Column list and allow‑listed columns.
  - Data types and type families (text, numeric, boolean, temporal, JSON, etc.).
  - Nullability and default values.
  - Constraints (primary keys, unique, checks), and foreign keys with referenced targets.
  - Index awareness for common filters/orderings to guide safe defaults.
  - Presence of RLS/policies; whether the anon role can read the data.
- **Preflight Checks** (must pass before run):
  - `from` references an allowed table/view.
  - All selected/aliased columns exist and are allowed.
  - Filters and orderings reference existing columns; operators are compatible with column types.
  - `limit`/`offset` within configured caps; preview limit uses a stricter cap.
  - If RLS blocks access, surface a policy‑aware error with remediation guidance.

### 5.3 DataSource Contract and Implementation
- **Contract**: A single method to execute a QueryConfig and return Supabase response data directly.
- **Implementation (Supabase)**: Translate QueryConfig to PostgREST calls. Return `{ data: T[], error: null | PostgrestError }` format. If `count` is provided for REST, call `.select(select, { count })` and expose the value only in metadata logs/UX.
- **Direct data flow**: Pass Supabase response data directly to UI components without normalization.
- **SSR Safety**: Initialize the client for **SPA-only** architecture; never expose secrets in the browser.

### 5.4 QueryRunner Responsibilities
- Validate with discovery invariants (no heavy client schema libs).
- Apply allow‑list policy for tables/columns.
- Delegate execution to the DataSource; return results as arrays.
- Emit metadata for observability (duration, row count, table name, optional total count) without leaking payloads.

### 5.5 Error Handling
- Centralize error shaping via a small helper that converts internal/config/transport failures into a Supabase-compatible `PostgrestError` while preserving original Supabase errors untouched. Log metadata only.

### 5.6 Optional Friendly Operator Adapter
- Provide an optional adapter that maps UI-friendly operators (e.g., contains/startsWith/endsWith/between) to PostgREST operators and value shapes prior to execution. Keep the core DSL PostgREST-native; adapter is purely ergonomic for the Designer.

### 5.7 Live (Realtime) — Separate Module
- Offer a thin helper to subscribe to table events (`INSERT`/`UPDATE`/`DELETE`) using Supabase Realtime channels. Keep it opt‑in and decoupled from the runner.

### 5.8 Caching and Serialization
- **Cache (optional)**: In‑memory TTL cache, key derived from a stable hash of QueryConfig. Define invalidation rules for all parameters.
- **Serialization**: Bidirectional JSON (to/from) with an explicit schema version for future migrations.

---

## 6. UI Blocks Specification

### 6.1 General Principles
- Receive Supabase data directly via props; no data transformation inside components.
- Use shadcn-svelte components with their native prop interfaces.
- Accessibility and keyboard navigation consistent with shadcn‑svelte patterns.
- Svelte 5 compatibility; use `$props()` and `$state()` patterns.

### 6.2 Baseline Blocks
- **Table**: Use shadcn-svelte Table component; accept `data: T[]` prop directly.
- **Card**: Use shadcn-svelte Card component; accept `data: T[]` prop directly.
- **List**: Simple list component; accept `data: T[]` prop directly.
- **Chart**: Chart component; accept `data: T[]` prop directly.

### 6.3 shadcn‑svelte Integration
- Use shadcn-svelte components as-is; no wrapper abstractions.
- Leverage `QueryData<typeof query>` for automatic TypeScript inference.

---

## 7. Designer and Canvas

### 7.1 Designer
- Stepwise flow: choose block → choose table/view (from discovery) → map required props to columns → build alias‑first select → preview → add to canvas.
- Use schema discovery to drive available columns and to validate mappings.
- Enforce preview caps; surface contract and policy errors early.
- Optional UX: expose friendly operators in the builder UI and map them via the adapter to PostgREST ops.

### 7.2 Canvas
- Sequential rendering of blocks from PageConfig.
- Per‑block error boundaries; loading and empty states.

### 7.3 Persistence
- Store PageConfig as JSON in the data store.
- Restore deterministically on load; include versioning and optimistic concurrency strategy.

---

## 8. Security, Privacy, and Performance

- **Secrets**: Only via environment; never log tokens or raw SQL.
- **RLS/Policies**: Rely on server‑side enforcement; the client uses least‑privileged roles.
- **Query Limits**: Enforce strict row caps and guard against full‑table scans; encourage indexed filters.
- **Performance**: Define P95 targets for reads; prefer indexed access paths. Preview must use tighter limits.
- **Telemetry**: Log only metadata (duration, row counts, table names, optional total count). No payload logging.

---

## 9. Acceptance Criteria

- Discovery‑based preflight checks prevent invalid configurations and unsafe scans.
- UI blocks receive already‑shaped data (alias‑first) and render without runtime errors on valid input.
- PageConfig serialization is deterministic and versioned.
- All quality gates pass (lint, typecheck, svelte‑check, unit/component tests where applicable).
- No leakage of secrets or personal data in logs.

---

## 10. Delivery Process

- **MCP usage**: Utilize context/doc lookups for shadcn‑svelte and supabase‑js, and database discovery for schema invariants.
- **Breadth‑first scaffolding**: Define types and interfaces first; implement in small, verifiable steps.
- **Gate after each step**: format → lint → typecheck → tests.
- **Documentation**: Keep README/architecture updated; record contract/version changes.

---

## 11. Risks and Mitigations

- **Schema drift**: Mitigate via discovery on each preflight and versioned PageConfig.
- **Library churn**: Isolate UI dependencies via re‑exports; pin versions.
- **Expensive scans**: Enforce limits; require filters on large tables; highlight index gaps.
- **Permissions/RLS pitfalls**: Surface policy‑aware errors; document remediation.
- **Caching staleness**: TTL + explicit invalidation; avoid caching when policy changes are suspected.
- **SSR pitfalls**: Use **SPA-only** client factories; never expose secrets client‑side.

---

## 12. Release Plan (MVP → Extensions)

- **M0**: Project skeleton, base dependencies, quality gates.
- **M1**: Data integration layer (QueryConfig, discovery‑based preflight, DataSource, QueryRunner, optional count support, centralized error helper), basic tests.
- **M2**: Alias helpers, optional in‑memory cache, JSON serialization, friendly operator adapter.
- **M3**: Minimal UI blocks and demo pages with mock data.
- **M4**: Designer and canvas, save/load PageConfig.
- **M5**: Live (Realtime) helper, access policy hardening, optional schema introspection UI, UX polish, documentation.

---

## 13. Definition of Done

- QueryConfig validated by discovery; cache/serialization operate per rules; blocks render cleanly on valid inputs.
- All static checks and tests are green; performance targets met for representative datasets.
- Documentation reflects current contracts, versions, and integration guidance.
