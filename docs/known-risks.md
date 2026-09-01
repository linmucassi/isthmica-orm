# Known risks

An honest register of what's still an open bet, kept separate from
[`roadmap.md`](./roadmap.md) because "not yet built" and "not yet validated
as *possible*" are different kinds of risk. Read this before committing a
timeline to anything marked still-open below.

## Still open

### Tenant-isolation type enforcement — first slice shipped, still bounded

**Partially resolved.** A first, real, tested implementation exists —
`tenantScoped()` in `@isthmica/core` (see
[`tenant-isolation.md`](./tenant-isolation.md)) makes a single-table
`SELECT` fail to *typecheck* if `.forTenant(id)` hasn't been called, via a
phantom-typed wrapper with `.execute()`/`.compile()`/`.executeTakeFirst()`
gated by a polymorphic `this` parameter. This was verified to genuinely
reject the unguarded call (not just silently accept a suppressed error) —
see the test file for how.

**Still explicitly out of scope**, per the original plan and unchanged by
this slice: joins, subqueries, and INSERT/UPDATE/DELETE. The wrapper only
covers single-table `SELECT`. Extending it to those cases is a real,
separate design effort — the current implementation doesn't generalize to
them automatically.

**New risk surfaced by shipping it:** this guarantee is only real if
`npm run typecheck` actually runs before code merges. **This repo has no CI
configured** (no `.github/workflows` directory exists). A
`// @ts-expect-error` test proves the mechanism works when someone runs
`tsc`, but `vitest` transpiles via esbuild and never type-checks — a
regression here would pass the test suite silently. See
[`best-practices.md`](./best-practices.md#dependency-hygiene).

### N+1 query detection

Not achievable via TypeScript's type system alone — it requires
control-flow/data-flow analysis across `await` points and loops, which means
a custom compiler plugin or a ts-morph/ESLint-style static-analysis pass,
not a "surfaces as a TypeScript compiler error" feature. Downgraded from the
original pitch to "researched, not promised." No work has started on this.

### Missing-index detection

Not a static-analysis problem — it needs live schema/index introspection
against a real database. Folded into the future index advisor (Phase 2),
which already assumes runtime telemetry rather than build-time analysis. No
work has started.

### Read-replica routing with automatic read-your-write consistency

A genuine correctness problem, not a convenience feature — a misjudged
consistency window produces silent stale reads that are painful to debug in
production. Needs a dedicated design spike before any timeline commitment.
Deliberately kept out of the phased roadmap (see `roadmap.md`) rather than
scheduled into Phase 3 by default.

### Migration rename disambiguation — still unsolved, now with a concrete shape

`@isthmica/migrations`' `diffSchemas` (see [`migrations.md`](./migrations.md))
exists now, and it does exactly what was planned here: a renamed column
(same object key with a new declared name, or vice versa) shows up as a
plain drop+add pair, not a detected rename. That's the honest,
explicitly-chosen non-solution — not an accident. What's still genuinely
unbuilt: the *assisted* confirmation flow (detect the ambiguous case,
prompt a human, let them confirm rename vs. drop+recreate) that every major
migration tool (Rails, Django, Prisma Migrate) has and this doesn't yet.
There's no CLI in this project at all yet, so there's nowhere for such a
prompt to live regardless.

### Prisma backend (`@isthmica/db-ops`) not integration-tested

`prisma.connect()` in `@isthmica/db-ops` is implemented against
`prisma-extension-kysely`'s documented v4 API (verified against the
package's own README) and Prisma 7's driver-adapter requirement, but has
never been run against a live Prisma client — this repo has no generated
Prisma client to test against, and the packages involved
(`@prisma/client`, `@prisma/adapter-pg`, `prisma-extension-kysely`) are
optional peer dependencies not installed here. See
[`db-ops.md`](./db-ops.md#prisma-backend). Treat it as
implemented-per-documentation, not verified-working, until someone runs it
against a real Postgres + Prisma 7 setup.

### MySQL backend (`@isthmica/db-ops`) not integration-tested

Same situation as Prisma, one step further removed: `mysql.connect()` is
implemented against Kysely's documented `MysqlDialect`/`MysqlPool`
structural interface (verified against Kysely's own source) and the
standard `mysql2` pairing, but has never run against a live MySQL server —
this repo has no MySQL instance to test against, only compile-only tests
(see [`db-ops.md`](./db-ops.md#mysql-backend)). `mysql2`'s exact
`Pool.end()` callback signature was not individually re-verified against
Kysely's expected shape beyond structural typechecking passing.

### Partitioning DDL not verified against live Postgres

`generateCreateTable`'s `PARTITION BY RANGE` clause and
`generateRangePartition`'s `PARTITION OF ... FOR VALUES FROM ... TO ...`
(see [`partitioning.md`](./partitioning.md)) are compile-only tested — no
live Postgres exists anywhere in this project, and SQLite doesn't support
partitioning at all (the `dialect: "sqlite"` option throws for a partitioned
table rather than silently ignoring `partitionBy`). Same honesty bar
already applied to the soft-delete plugin: implemented-per-documentation,
not execution-verified.

### Adding a NOT NULL column without a default fails against non-empty tables

Found while testing `@isthmica/migrations`' `applyMigration`, not a
hypothetical: adding a `.notNull()` column to a table that already has rows
fails at the database level (every existing row would get `NULL` for the
new column, violating the constraint being added in the same statement).
This is real, current, and *not* solved by expand/contract splitting (add
nullable → backfill → add constraint) — that's a deliberately separate,
larger Phase 1 item, not something this first migrations slice attempts.
There's a regression test confirming this throws rather than silently
producing an inconsistent schema — see
[`migrations.md`](./migrations.md#known-limitations).

### `pg`/`mysql2` static-vs-dynamic import asymmetry in `@isthmica/db-ops`

`pg.ts` uses a static top-level `import ... from "pg"`, while `prisma.ts`
and `mysql.ts` both use dynamic `import()` specifically so requiring
`@isthmica/db-ops` doesn't force those optional peers to be installed.
`pg` doesn't get the same treatment — it's treated as the assumed default
dialect throughout this project's docs (the README's quick example,
`db-ops.md`'s primary walkthrough), so importing *anything* from
`@isthmica/db-ops` today technically requires `pg` to be installed even if
you only intend to use `mysql`/`prisma`. In practice this is narrow (most
consumers reaching for this package have `pg` installed anyway, since it's
the only fully-supported `@isthmica/core` dialect), but it's a real,
un-fixed inconsistency, not a deliberate design choice — flagged here
rather than left silently inconsistent. Converting `pg.connect()` to an
async, dynamically-imported function would fix it but is a breaking API
change to already-documented, already-tested code, so it wasn't done as a
side effect of adding the `mysql2` backend.

### Package/domain naming

`isthmica`, `isthmica-orm`, `isthmicadb`, `@isthmica/core`, `@isthmica/db-ops`,
and `@isthmica/migrations` were confirmed unpublished on the npm registry
directly (all return HTTP 404, checked via `registry.npmjs.org`, not just
assumed from an earlier draft). Domain availability (`isthmica.dev` / `.io`)
has not been checked from this environment. A formal trademark search
(USPTO/EUIPO or equivalent) has not been done and is recommended before any
public launch.

## Fixed — closed, not just documented

These were real, discovered bugs — each has a regression test, not just a
note. Kept here (rather than deleted) so the fix and its context stay
visible, matching how this project handles every correction.

### Soft-delete plugin referenced the real table name instead of the alias

Found via the external edge-case test suite, not this repo's own tests:
`.selectFrom("orders as o")` used to produce a filter referencing
`"orders"."deleted_at"` — out of scope after aliasing, a real SQL error
against a live database. Fixed in
`packages/core/src/plugins/soft-delete.ts`: `extractTableRef` (now shared
with `audit.ts` via `plugins/table-name.ts`) tracks the alias separately
from the real name used only for matching against configured tables. See
[`soft-delete.md`](./soft-delete.md).

### Soft delete didn't scope writes against already-deleted rows

The AST transformer used to only override `transformSelectQuery`. An
`UPDATE` against a row that's already soft-deleted now affects 0 rows by
default (via a new `transformUpdateQuery` override, sharing the same
filter-building logic) — a deliberate behavior change, not just a doc
update. `.deleteFrom()` remains intentionally unscoped (Kysely's plugin API
can't turn a real `DELETE` into an `UPDATE` — see
[`soft-delete.md`](./soft-delete.md#why-deletefrom-is-not-intercepted)).

### Column object key vs. declared column name

The string passed to `text()`/`serial()`/`timestamp()` (e.g.
`text("tenant_id")`) used to be metadata-only — Kysely's typed queries
referenced the object key (`tenantId`), not the declared name. Fixed by
giving `ColumnBuilder` a literal-string `TName` type parameter and rekeying
`InferRawTable` by it. `InferSelect`/`InferInsert`/`InferUpdate`
(JS-facing) deliberately stay keyed by object key — a *separate* mapped
type (`InferObjectKeyedRawTable`), not derived from `InferRawTable`,
because deriving them was tried first and silently re-keyed them too (see
`table.ts`'s comments). `@isthmica/db-ops`'s `createRepository` now
translates between the two shapes at its boundary
(`toRawRecord`/`fromRawRow` in `repository.ts`) so its public API stays
entirely object-key-shaped. See
[`schema-dsl.md`](./schema-dsl.md#inferdatabase).

### `InferInsert`/`InferSelect` didn't mark DB-generated columns optional

A column typed `number | undefined` via a hand-rolled mapped type is a
*required* key whose value may be `undefined`, not an *optional* key —
`repo.insert({ label: "x" })` for a table with an auto-generated `id`
failed to typecheck. Fixed by building `InferSelect`/`InferInsert`/
`InferUpdate` on Kysely's own `Selectable`/`Insertable`/`Updateable`
utilities instead. See [`schema-dsl.md`](./schema-dsl.md#inferdatabase).

### `softDeleteUpdate` used a JS `Date`, which isn't portable

Worked against Postgres (the `pg` driver serializes JS `Date`) but SQLite's
driver rejects a bound `Date` outright. Fixed with `sql`current_timestamp``
— standard SQL, valid on every dialect, and arguably better anyway
(DB-server clock instead of app-server clock). See
[`soft-delete.md`](./soft-delete.md#api-summary).

### `createRepository().update()` with an empty values object

Compiled to `UPDATE ... SET  WHERE ...` — an empty `SET` clause, a raw SQL
syntax error at the driver rather than a validation error. Easy to hit by
accident from code that conditionally builds a partial update object.
Fixed: an empty `values` object now short-circuits to `get(id)`, a true
no-op. See [`db-ops.md`](./db-ops.md).

## Mitigated, but not eliminated

### Coupling to Kysely's `@internal`-marked AST API

Both the soft-delete plugin and the audit plugin (`plugins/table-name.ts`'s
`extractTableRef`, `OperationNodeTransformer`, `WhereNode`, `ReturningNode`,
`SelectionNode`, and friends) depend on Kysely internals explicitly marked
`@internal` in source, with no publicly documented plugin-authoring guide
backing them. Both are now implemented and tested, which is meaningfully
different from "unvalidated" — but this is an **ongoing** risk, not a
closed one: it needs re-checking on every Kysely upgrade. The audit
plugin's `transformResult`/`WeakMap<QueryId,...>` half sits on firmer
ground — that exact pattern is documented in `KyselyPlugin`'s own JSDoc,
unlike the AST-node factories. See
[`best-practices.md`](./best-practices.md#dependency-hygiene) for the
specific check to run.

### Kysely SQL-injection advisories (CVE-relevant, pre-0.29.5)

Caught during this project's own dependency install, not assumed from a
changelog: Kysely versions up to and including 0.28.16 have real advisories
(JSON-path traversal injection, insufficient MySQL backslash escaping),
fixed in 0.29.5. Every package in this workspace pins its dev dependency at
`^0.29.5` and its peer dependency floor at `^0.29.0`. Closed for this
codebase; still worth `npm audit`-checking any project consuming it, since
a peer dependency range doesn't stop a consumer from installing something
older.
