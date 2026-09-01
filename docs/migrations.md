# Migrations (`@isthmica/migrations`)

Status: 🟡 **first slice implemented** (`packages/migrations/src`), tested
with real execution. Optional — depends on `@isthmica/core`, nothing in
`@isthmica/core` depends on it. This is explicitly the first slice of the
originally-planned Phase 1 (assisted expand/contract, a linter, shadow-DB
dry runs) — those larger pieces are not built; see
[`roadmap.md`](./roadmap.md).

## What it does

Three pieces, each usable independently:

```ts
import { generateCreateTable, diffSchemas, applyMigration } from "@isthmica/migrations";

// Generate DDL from a table() definition, driven by Kysely's own schema
// builder (not hand-formatted SQL):
await generateCreateTable(db, orders).execute();

// Pure data-structure diff between two schema snapshots — no DB needed:
const diff = diffSchemas([ordersV1], [ordersV2]);
// { addedTables: [...], removedTables: [...], changedTables: [{ table, addedColumns, removedColumns }] }

// Apply that diff: creates added tables, adds/drops columns on changed
// tables, drops removed tables — all in one transaction:
await applyMigration(db, [ordersV1], [ordersV2]);
```

## `generateCreateTable(db, table, options?)`

Drives Kysely's own `db.schema.createTable(...).addColumn(...)` builder —
not hand-formatted SQL strings — for correctness and dialect-aware
escaping. Returns a `CreateTableBuilder`; call `.execute()` to run it or
`.compile()` to inspect the SQL first.

`options.dialect` is `"postgres"` (the default — `@isthmica/core` is
Postgres-only, see [`architecture.md`](./architecture.md)) or `"sqlite"`.
**`"sqlite"` exists solely so this package is real-execution-testable in
this project** — there's no live Postgres anywhere in the test suite — not
as a second shipped target. SQLite gets `integer` + `autoIncrement()`
instead of `serial`, and `text` instead of `timestamp` (SQLite has no
native timestamp type).

### A column-metadata heuristic worth knowing about

`ColumnBuilder.hasDefault` is `true` for *both* `.primaryKey()`
(DB-generated, no explicit default) and `.defaultNow()` (a real
`current_timestamp` default) — it can't drive DDL generation on its own.
`generateCreateTable` disambiguates by `dataType`/`isPrimaryKey` combination
instead: a `timestamp` column with `hasDefault` that *isn't* the primary key
gets `.defaultTo(sql\`current_timestamp\`)`. This is scoped to today's exact
`column.ts` factory set — a future generic `.default(value)` column
modifier would need `hasDefault` to become a richer field, not a silent
extension of this heuristic.

## `diffSchemas(before, after)`

Pure data-structure diff, no DB connection needed. Tables are matched by
declared name; columns within a matched table are matched by declared name
too (not object key), consistent with `generateCreateTable`.

**A renamed column shows up as a plain drop+add pair.** This is a
deliberate, honest non-solution, not a bug: distinguishing a rename from a
drop-and-recreate is a structurally ambiguous diff that every major
migration tool (Rails, Django, Prisma Migrate) routes through human
confirmation rather than guessing. That confirmation flow doesn't exist in
this project yet — see [`known-risks.md`](./known-risks.md).

## `applyMigration(db, before, after, options?)`

Applies `diffSchemas`' output inside one transaction: `generateCreateTable`
for added tables, Kysely's `AlterTableBuilder` (`addColumn`/`dropColumn`)
for changed tables, `dropTable` for removed tables.

### Known limitations

- **Adding a NOT NULL column to a table with existing rows fails.** Every
  existing row would get `NULL` for the new column, violating the
  constraint in the same statement — every real database rejects this.
  This first slice doesn't do expand/contract splitting (add nullable →
  backfill → add constraint) to work around it; that's a deliberately
  separate, larger Phase 1 item. There's a regression test confirming this
  throws rather than silently producing an inconsistent schema
  (`packages/migrations/test/migrate.test.ts`).
- **Column renames are drop+add**, per `diffSchemas` above — data in a
  "renamed" column is lost, not migrated, unless you handle it yourself.
- **No down migrations, no migration history table, no CLI.** This is
  schema-diff-and-apply, not a migration *framework* — there's no
  `isthmica migrate:up`/`:down`, no record of what's been applied where.

## Partitioning

`generateCreateTable` also handles a table's `partitionBy` option —
see [`partitioning.md`](./partitioning.md), which extends this page rather
than duplicating it.

## Testing

- `test/ddl.test.ts` — real SQLite execution: generate DDL, actually run
  it, insert via `InferInsert`, confirm the round trip. Also covers the
  `hasDefault`/`isPrimaryKey` disambiguation directly.
- `test/diff.test.ts` — pure unit tests, no DB (added/removed
  tables/columns, the rename-as-drop+add behavior, no-op on identical
  schemas).
- `test/migrate.test.ts` — real SQLite execution: create → insert data →
  diff → apply → confirm old data survives and new columns are queryable;
  also the NOT-NULL-without-default failure case above, and dropped
  columns/tables actually becoming unqueryable.
