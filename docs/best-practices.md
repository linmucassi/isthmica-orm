# Best practices

Guidance for the parts of Isthmica that exist today. This will grow as more
of the roadmap ships — a "best practice" for a feature that isn't built yet
isn't a best practice, it's a guess, so this page stays scoped to what's
actually implemented: [`schema-dsl.md`](./schema-dsl.md),
[`soft-delete.md`](./soft-delete.md), [`audit.md`](./audit.md),
[`tenant-isolation.md`](./tenant-isolation.md), and
[`migrations.md`](./migrations.md)/[`partitioning.md`](./partitioning.md).

## Schema definitions

- **Declare tables in one module, import the record everywhere you need
  `InferDatabase`.** `getting-started.md`'s pattern — a `schema.ts` exporting
  both individual tables and a `tables` record — keeps the source of truth
  for `InferDatabase` and for `withSoftDelete()`'s table list identical. If
  those two ever drift (e.g. a table added to your `Database` type but not
  passed to `withSoftDelete`), soft delete silently won't apply to it — no
  error, it just won't scope that table.
- **Set `softDelete: true` at the table definition, not ad hoc per query.**
  The whole point of the plugin is that scoping isn't something call sites
  have to remember. If you find yourself wanting to soft-delete only some
  queries against a table, that's a sign the table shouldn't have
  `softDelete: true` at all — use `softDeleteUpdate` and manual filtering
  for that table instead of fighting the automatic scoping.
- **Don't rely on `ColumnBuilder`'s runtime metadata
  (`isPrimaryKey`/`isNotNull`/`hasDefault`) in application code.** They now
  have a real consumer — `@isthmica/migrations`' `generateCreateTable` (see
  [`migrations.md`](./migrations.md)) — but that consumer's exact
  interpretation of these fields (in particular, the `hasDefault`
  heuristic) is scoped to today's column factory set, not a stable,
  general introspection contract you should build application logic on
  top of.

## Soft delete

- **Know the exact boundary of what's scoped: `SELECT` and `UPDATE`
  through the Kysely query builder — not `.deleteFrom()`, not raw `sql`.**
  Re-read [`soft-delete.md`](./soft-delete.md#what-it-does-not-do) before
  assuming coverage beyond that; `.deleteFrom()` genuinely can't be scoped
  by a plugin (see that page for why), and raw `sql` tags are opaque to
  the AST transformer regardless.
- **Use `softDeleteUpdate()` for the write side of soft-*deleting*, always,
  and don't try to "simplify" it into a raw `.updateTable()` call.**
  `softDeleteUpdate` runs against `withDeleted()` internally specifically
  so it can soft-delete a row regardless of current `deleted_at` state — a
  hand-written `.updateTable()` call against the scoped `db` would silently
  fail to update an already-deleted row (0 rows affected) if you're ever
  trying to, say, correct a bad `deleted_at` value.
- **Treat `withDeleted()` as an admin/support-tooling escape hatch, not a
  routine query modifier.** It turns off every plugin on the instance, not
  just soft-delete scoping — on a table with both `softDelete: true` and
  `audit: true`, `withDeleted()` silences audit capture too. Reach for it
  deliberately, and audit where it's called the same way you'd audit any
  other "bypass the safety filter" code path.
- **If a query against a soft-delete table returns unexpected empty results
  (or an `UPDATE` unexpectedly affects 0 rows) in tests, check the filter
  before assuming a data problem.** The plugin adds `AND` conditions
  transparently — a query that "shouldn't" be affected because it doesn't
  reference `deleted_at` explicitly is still filtered if it touches a
  soft-delete table, on both reads and writes now.

## Audit

- **The sink function should not throw for expected conditions.** It runs
  inside `transformResult`, in the same async path as the query itself —
  an unhandled rejection there propagates back to whatever called
  `.execute()`. Handle your own sink's failure modes (a downed Kafka
  broker, a webhook timeout) inside the sink, not by letting them surface
  as a mysterious failure on an unrelated insert.
- **Remember post-image only.** If your sink needs "what changed," diff it
  yourself from your own audit history, or design around not needing a
  pre-image at all (e.g. status-transition columns instead of free-form
  mutable fields). See [`audit.md`](./audit.md) for why pre-image capture
  isn't in scope.

## Tenant isolation

- **`npm run typecheck` must actually run before you trust the guarantee.**
  This project has no CI configured yet (see
  [`known-risks.md`](./known-risks.md)) — `tenantScoped()`'s whole value
  proposition is a compile-time check, and `vitest` never performs one
  (it transpiles via esbuild). Run `npm run typecheck` yourself before
  merging anything that touches `tenant.ts`, or set up CI to do it, rather
  than trusting the test suite alone.
- **Don't reach for `tenantScoped()` on anything beyond single-table
  `SELECT`.** It doesn't cover joins, subqueries, or writes — see
  [`tenant-isolation.md`](./tenant-isolation.md). Using it for the subset
  it covers and a manual, careful review for everything else is more
  honest than assuming broader coverage than it has.

## Testing without a live database

`@isthmica/core`'s own tests never open a database connection —
`packages/core/test/soft-delete.test.ts` is the reference pattern:

```ts
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";

function createTestDb(): Kysely<DB> {
  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new Pool({ host: "unused", max: 0 }) }),
  });
}

const { sql } = db.selectFrom("orders").selectAll().compile();
expect(sql).toContain('"deleted_at" is null');
```

`Kysely`, `pg.Pool`, and `PostgresDialect` are all lazy — constructing them
doesn't open a connection, and `.compile()` never executes anything. This
means plugin behavior (does the right filter get added? does it get ANDed
correctly? does a join get scoped per-table?) is fully testable by asserting
on the compiled SQL string, with no test-database infrastructure required.

Reach for this pattern for anything that's really a query-shape question.
Save actual database integration tests for behavior that can only be
observed by running the query — constraint violations, actual soft-delete
row counts after a real `softDeleteUpdate()`, transaction behavior.

## Dependency hygiene

- **Don't pin Kysely below `0.29.5`** in a project depending on
  `@isthmica/core` — versions up to and including 0.28.16 have real
  SQL-injection advisories (JSON-path traversal, insufficient backslash
  escaping in MySQL string literals), fixed in 0.29.5. This was caught
  during this project's own setup via `npm audit`, not assumed — worth
  running the same check yourself when bumping dependencies rather than
  trusting a changelog summary.
- **If you upgrade Kysely inside this monorepo, re-check the internal AST
  APIs the soft-delete *and* audit plugins depend on before assuming either
  still works** — they now share `plugins/table-name.ts`, so a breaking
  change there breaks both at once. See
  [`soft-delete.md`](./soft-delete.md#built-on-internal-kysely-apis--read-this-before-upgrading-kysely)
  for exactly which node factories and method signatures to diff against the
  new version's source. The tenant-isolation wrapper (`tenant.ts`) is a
  separate risk again — it doesn't use the AST-node factories at all, but
  couples to `SelectQueryBuilder`'s own generic method signatures instead
  (see [`tenant-isolation.md`](./tenant-isolation.md)), which can shift
  independently of the AST node shapes on a Kysely upgrade.
