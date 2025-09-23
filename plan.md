# Technical Specification — Integration Layer for Supabase × SvelteKit × shadcn‑svelte (Alias‑First)

This document defines goals, architectural contracts, and acceptance criteria for a thin, verifiable integration layer between a data source (Supabase) and UI components (shadcn‑svelte) within a SvelteKit application. The specification emphasizes stability, replaceability, and verifiability. Concrete code examples are intentionally omitted.

---

## 1. Purpose and Scope

- **Objective**: Provide a minimal, stable integration layer that enables composing pages from UI blocks backed by configurable data queries, prioritizing alias‑first data shaping.
- **Alias‑First Principle**: Produce final field names at the data edge (PostgREST with aliases) so the UI receives ready‑to‑render keys with no ad‑hoc transformations inside components.
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
- **Data Integration Layer**: Declarative QueryConfig, preflight using Supabase schema invariants, DataSource executor, QueryRunner, optional cache.
- **UI Layer**: Stable block contracts (table, card, list, chart) with minimal props; no in‑component mapping logic.
- **Designer**: Alias mapping wizard, contract checks, preview, add to canvas.
- **Persistence**: Save/load page configurations as JSON in the data store.

### 4.2 Stability Contracts
- **Layer independence**: UI is unaware of data source mechanics; receives already‑shaped data.
- **Small, explicit interfaces**: Single‑responsibility modules; typed contracts.
- **Determinism**: Serializable configs, predictable rendering, no hidden transforms.

---

## 5. Data Layer Specification

### 5.1 Declarative QueryConfig
- **Shape**: A typed object describing source kind (e.g., `rest` or `sql` when applicable), target table/view, alias‑first `select`, filters, ordering, and pagination.
- **Rules**:
  - Aliases are required for all fields consumed by the UI blocks.
  - Client executes read‑safe operations only; computed fields are produced in the database (views or RPC).
  - Enforce strict row limits and protect previews from accidental scans.
  - Perform preflight checks before execution; surface actionable, user‑friendly errors.

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
- **Error Taxonomy**:
  - Configuration error (invalid table/column/operator/limit).
  - Policy/permission error (RLS or role not permitted).
  - Transport/runtime error (network, transient failure).
  - Server/data error (e.g., failed view/RPC). Log metadata only.

### 5.3 DataSource Contract and Implementation
- **Contract**: A single method to execute a QueryConfig and return a flat array of objects with aliased keys.
- **Implementation (Supabase)**: Translate QueryConfig to PostgREST (and SQL/RPC when explicitly allowed). Normalize errors, enforce caps, avoid logging sensitive content.
- **SSR Safety**: Initialize the client for **SPA-only** architecture; never expose secrets in the browser.

### 5.4 QueryRunner Responsibilities
- Validate with discovery invariants (no heavy client schema libs).
- Apply allow‑list policy for tables/columns.
- Delegate execution to the DataSource; return results as arrays.
- Emit metadata for observability (duration, row count, table name) without leaking payloads.

### 5.5 Caching and Serialization
- **Cache (optional)**: In‑memory TTL cache, key derived from a stable hash of QueryConfig. Define invalidation rules for all parameters.
- **Serialization**: Bidirectional JSON (to/from) with an explicit schema version for future migrations.

---

## 6. UI Blocks Specification

### 6.1 General Principles
- Minimal, stable props; no data shaping inside components.
- Accessibility and keyboard navigation consistent with shadcn‑svelte patterns.
- Svelte 5 compatibility; use recommended composition patterns.

### 6.2 Baseline Blocks
- **Table**: Columns derived from item keys; empty state; header stability; scrolling/pagination guidance.
- **Card**: Grid layout; required title; optional companions; resilience to long text.
- **List**: Vertical list; optional meta; keyboard navigation.
- **Chart**: Simple numeric visualization; autoscaling; neutral number/date formatting.

### 6.3 shadcn‑svelte Integration
- Align with `huntabyte/shadcn-svelte` component APIs and accessibility expectations.
- Respect headless and styling dependencies; isolate re‑exports to shield internal changes.
- Keep the block contracts independent of UI library internals.

---

## 7. Designer and Canvas

### 7.1 Designer
- Stepwise flow: choose block → choose table/view → map required props to columns → build alias‑select → preview → add to canvas.
- Use schema discovery to drive available columns and to validate mappings.
- Enforce preview caps; surface contract and policy errors early.
- Do not implement heavy client validation; trust database invariants and discovery. A future “form view” will introduce a rule‑mapping layer; it is out of scope now.

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
- **Telemetry**: Log only metadata (duration, row counts, table names). No payload logging.

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
- **M1**: Data integration layer (QueryConfig, discovery‑based preflight, DataSource, QueryRunner), basic tests.
- **M2**: Alias helpers, optional in‑memory cache, JSON serialization.
- **M3**: Minimal UI blocks and demo pages with mock data.
- **M4**: Designer and canvas, save/load PageConfig.
- **M5**: Access policy hardening, optional schema introspection UI, UX polish, documentation.
- Future: Form view rule‑mapping validation layer (maps DB constraints to UI validation), advanced charts, server‑side pagination helpers, i18n, telemetry integrations.

---

## 13. Definition of Done

- QueryConfig validated by discovery; cache/serialization operate per rules; blocks render cleanly on valid inputs.
- All static checks and tests are green; performance targets met for representative datasets.
- Documentation reflects current contracts, versions, and integration guidance.
