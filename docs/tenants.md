# Tenants

## TL;DR
- **Tenant model**: one tenant per PostgreSQL schema (`tenant_<slug_or_id>`)
- **Do not use Supabase Organizations API for app-level tenants**. It manages Supabase infra orgs/projects, not your app data. Use an app-level `app.organizations` table instead. Mapping `Organization == Tenant` is valid only inside your app database model, not the Supabase Management layer.
- **Memberships**: `auth.users(id)` ↔ `app.memberships(organization_id, user_id, role)`
- **Access**: client picks active tenant by schema and queries via `supabase.schema('<tenant>').from('...')`
- **RLS**: each tenant schema enforces membership via `app.memberships` and a per-schema `tenant.current_organization_id()` function
- **Creation**: `app.create_organization(name, slug)` creates org + schema, installs tables, policies


## Think single tenant
When building application features, think in single-tenant terms. Multitenancy is reduced to a single line that selects the schema: `supabase.schema('tenant_<slug>')`. All tables, RLS, and queries are defined per schema, so components, CRUD flows, and validations are implemented exactly like in a regular single-tenant app. Switching organizations in the UI simply changes the schema name; the rest of the code remains identical. On the server, background jobs and admin tools also specify the schema explicitly.


## Why not Supabase Organizations API as tenants?
- Supabase Organizations/Management API is for provisioning/operating Supabase itself (orgs, projects, keys). In self-hosted it’s available.
- For app multitenancy, keep everything inside your project database: tables, schemas, RLS. Treat your own `Organization` entity as a tenant.


## Objectives
- Strong isolation by schema-per-tenant.
- Users can belong to multiple tenants.
- Single sign-on via Supabase Auth (`auth.users`).
- Simple, performant RLS that doesn’t depend on custom JWT mutation.
- Minimal coupling; easy lifecycle (create, invite, suspend, delete).


## Data model (app schema)
Create an application schema for control tables and helpers:

```sql
create schema if not exists app;

create type app.role as enum ('owner','admin','member','viewer');

create table if not exists app.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
  name text not null,
  schema_name text unique not null,
  created_at timestamptz not null default now(),
  suspended_at timestamptz
);

create table if not exists app.memberships (
  organization_id uuid not null references app.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role app.role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

-- Optional invitations (email based)
create table if not exists app.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app.organizations(id) on delete cascade,
  email citext not null,
  role app.role not null default 'member',
  invited_by uuid not null references auth.users(id) on delete set null,
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, email)
);
```


## Helper functions (app schema)

```sql
-- Read role from JWT (service role bypass) safely
create or replace function app.jwt_claim(claim text)
returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> claim,
    ''
  );
$$;

create or replace function app.is_service_role()
returns boolean language sql stable as $$
  select app.jwt_claim('role') = 'service_role';
$$;

create or replace function app.has_org_role(org_id uuid, min_role app.role)
returns boolean language plpgsql stable as $$
begin
  if app.is_service_role() then
    return true;
  end if;
  return exists (
    select 1
    from app.memberships m
    where m.organization_id = org_id
      and m.user_id = auth.uid()
      and (
        -- role order: owner > admin > member > viewer
        case m.role when 'owner' then 4 when 'admin' then 3 when 'member' then 2 else 1 end
        >=
        case min_role when 'owner' then 4 when 'admin' then 3 when 'member' then 2 else 1 end
      )
  );
end;
$$;
```


## Tenant schema bootstrap
Each tenant schema includes:
- a constant function `tenant.current_organization_id()` returning the owning `app.organizations.id`
- application tables for that tenant
- RLS templates referencing `tenant.current_organization_id()` and `app.has_org_role(...)`

Bootstrap function:

```sql
create or replace function app.create_organization(p_name text, p_slug text)
returns app.organizations
language plpgsql security definer set search_path = public, extensions, pg_temp, app as $$
declare
  v_schema text := 'tenant_' || p_slug;
  v_org app.organizations;
begin
  -- Create org row
  insert into app.organizations(name, slug, schema_name)
  values (p_name, p_slug, v_schema)
  returning * into v_org;

  -- Create schema
  execute format('create schema if not exists %I', v_schema);

  -- Bind org id function inside tenant schema
  execute format($f$
    create or replace function %I.current_organization_id()
    returns uuid language sql stable as $$ select %L::uuid $$;
  $f$, v_schema, v_org.id);

  -- Example tenant tables (adjust per app domain)
  execute format($f$
    create table if not exists %I.projects (
      id uuid primary key default gen_random_uuid(),
      title text not null,
      created_at timestamptz not null default now()
    );
  $f$, v_schema);

  -- RLS policies template on tenant tables
  execute format($f$
    alter table %I.projects enable row level security;
    create policy projects_select on %I.projects
      for select using ( app.has_org_role(%I.current_organization_id(), 'viewer') );
    create policy projects_insert on %I.projects
      for insert with check ( app.has_org_role(%I.current_organization_id(), 'member') );
    create policy projects_update on %I.projects
      for update using ( app.has_org_role(%I.current_organization_id(), 'member') )
               with check ( app.has_org_role(%I.current_organization_id(), 'member') );
    create policy projects_delete on %I.projects
      for delete using ( app.has_org_role(%I.current_organization_id(), 'admin') );
  $f$, v_schema, v_schema, v_schema, v_schema, v_schema, v_schema, v_schema);

  return v_org;
end;
$$;
```

Notes:
- The function is `security definer` and should be owned by a privileged role (run via service key or migration).
- Add more tenant tables and policies as needed; reuse the same pattern.


## RLS strategy
- No need to inject `tenant_id` into JWT. Policies derive the tenant from schema-local `tenant.current_organization_id()` and check membership via `app.memberships` with `auth.uid()`.
- Service role (backend/admin) bypass uses the claim `role = 'service_role'`.
- Users can be members of multiple organizations; access to a schema is granted if membership exists for its owning org.


## Client usage (supabase-js v2)
Pick the active tenant schema on the client and query its tables. Example:

```ts
// choose schema by the selected organization (store slug → schema_name)
const schema = `tenant_${selectedOrgSlug}`;

// reads
const { data, error } = await supabase
  .schema(schema)
  .from('projects')
  .select('*')
  .order('created_at', { ascending: false });

// writes
const { error: insertError } = await supabase
  .schema(schema)
  .from('projects')
  .insert({ title: 'New project' });
```

Invitations flow:
- Create invitation in `app.invitations` with `role`.
- On accept, insert into `app.memberships` and delete the invitation.


## Admin operations
- Create org + schema: call `rpc('app.create_organization', { p_name, p_slug })` with service key or via migration.
- Add member: `insert into app.memberships (organization_id, user_id, role) values (...)` (admin/owner only; protect via RLS on `app.memberships`).
- Suspend org: set `suspended_at` and update tenant-table RLS to additionally check `app.organizations.suspended_at is null` (or enforce via a `app.organization_is_active(id)` helper and policy).


## Optional: template cloning
If many tenant tables exist, maintain a `tenant_template` schema in migrations and, during bootstrap, clone structure:

```sql
-- inside create_organization, replace table DDL with:
execute (
  select string_agg(
    replace(replace(pg_get_viewdef(oid), 'tenant_template.', format('%I.', v_schema)), 'CREATE VIEW', 'create view'),
    E';\n'
  )
  from pg_class
  where relnamespace = 'tenant_template'::regnamespace and relkind in ('r','v')
);
```

Alternatively, use `CREATE TABLE ... (LIKE tenant_template.table INCLUDING ALL)` for each required table.


## Security considerations
- Never expose service key to clients.
- All tenant tables must have RLS enabled; add a test to assert this.
- Policies must reference `tenant.current_organization_id()` so no cross-tenant leakage is possible even if a client changes schema manually.
- Avoid dynamic SQL in user-invoked functions; only in admin-controlled bootstrap.


## Testing checklist
- A user without membership cannot read/write in a tenant schema.
- A member can read, a member/admin can write; only admin/owner can delete.
- Service role can read/write across tenants for backend tasks.
- Switching schema in the client switches the visible data accordingly.


## Q&A
- **Can `Organization == Tenant`?** Yes, inside your app database model (`app.organizations`). Do not conflate with Supabase cloud Organizations.
- **Do we need to add `tenant_id` to `auth.users`?** No. Keep `auth.users` immutable and model memberships in `app.memberships`.
- **JWT custom claim for tenant?** Optional. With schema selection + RLS as above it’s not required and avoids token re-issuance on tenant switch.
