# Best practices

Guidance for the parts of Isthmica that exist today. This will grow as more
of the roadmap ships — a "best practice" for a feature that isn't built yet
isn't a best practice, it's a guess, so this page stays scoped to
[`schema-dsl.md`](./schema-dsl.md) and [`soft-delete.md`](./soft-delete.md).

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
  (`isPrimaryKey`/`isNotNull`/`hasDefault`) in application code.** Nothing in
  `@isthmica/core` guarantees these stay stable in shape as the migrations
  engine gets built against them (Phase 1) — they're currently populated for
  future internal use, not as a public introspection API.

## Soft delete

- **Know the exact boundary of what's scoped: `SELECT` only, and only
  through the Kysely query builder.** Re-read
  [`soft-delete.md`](./soft-delete.md#what-it-does-not-do) before assuming
  an `UPDATE`, a `.deleteFrom()`, or a raw `sql` tag against a soft-delete
  table is covered — none of them are today.
- **Use `softDeleteUpdate()` for the write side, always, and don't try to
  "simplify" it into a raw `.updateTable()` call in application code.**
  Centralizing the write path means the day scoped updates/deletes do get
  built (a real gap noted in `soft-delete.md`), there's one call site to
  change instead of every place a table gets soft-deleted.
- **Treat `withDeleted()` as an admin/support-tooling escape hatch, not a
  routine query modifier.** It turns off every plugin on the instance, not
  just soft-delete scoping — reach for it deliberately, and audit where it's
  called the same way you'd audit any other "bypass the safety filter" code
  path, especially once audit/CDC plugins exist and get silenced by it too.
- **If a query against a soft-delete table returns unexpected empty results
  in tests, check the filter before assuming a data problem.** The plugin
  adds `AND` conditions transparently — a query that "shouldn't" be affected
  because it doesn't reference `deleted_at` explicitly is still filtered if
  it touches a soft-delete table.

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
  APIs the soft-delete plugin depends on before assuming it still works** —
  see [`soft-delete.md`](./soft-delete.md#built-on-internal-kysely-apis--read-this-before-upgrading-kysely)
  for exactly which node factories and method signatures to diff against the
  new version's source.
