# Soft delete

Status: ✅ implemented (`packages/core/src/plugins/soft-delete.ts`,
`packages/core/src/db.ts`). This page explains the mechanism in enough
detail that you can predict what it will and won't catch — soft delete is
a correctness feature, and correctness features are only useful if you know
their edges.

## The mechanism

`createSoftDeletePlugin({ tables, deletedAtColumn })` returns a Kysely
`KyselyPlugin`. `withSoftDelete(db, tables)` installs it automatically for
every table whose `TableOptions.softDelete` is `true`.

Under the hood, it's built on `OperationNodeTransformer`, which walks
Kysely's query AST and lets you rewrite specific node kinds. This plugin
overrides two: `transformSelectQuery` and `transformUpdateQuery`. For every
`SELECT`/`UPDATE` node in the tree — including nested subqueries, since the
transformer recurses into them the same way — it:

1. Collects the table references involved (a `SELECT`'s `FROM`/`JOIN`
   clauses; an `UPDATE`'s target table plus any `FROM`/`JOIN` it has),
   resolving each to both its *real* declared name (for matching against
   the configured soft-delete table set) and its *in-scope reference name*
   — the alias if the query aliased it, otherwise the real name. This
   real/ref split matters: an earlier version of this plugin used the real
   name even when the query aliased the table, producing a filter
   referencing an identifier out of scope after aliasing — a real SQL
   error, since fixed (see
   [`known-risks.md`](./known-risks.md#fixed--closed-not-just-documented)).
   This resolution logic (`extractTableRef`) now lives in a shared
   `plugins/table-name.ts`, also used by [the audit plugin](./audit.md).
2. Filters that list down to the ones configured for soft delete.
3. If any match, builds `<ref>.<deletedAtColumn> IS NULL` for each one
   (using Kysely's own `expressionBuilder`, not hand-built SQL strings —
   `<ref>` here is the alias when the table was aliased, not the real
   name), ANDs them together if there's more than one, and ANDs the result
   onto whatever `WHERE` clause the query already had — or creates one if
   it didn't have any.

This is why `.innerJoin("tenants", ...)` against `orders` (soft-delete) and
`tenants` (not) produces `"orders"."deleted_at" is null` but nothing for
`tenants` — the filter is applied per matched table, not globally. And why
`.selectFrom("orders as o")` produces `"o"."deleted_at" is null`, not
`"orders"."deleted_at" is null` — the alias, not the real name.

### Built on `@internal` Kysely APIs — read this before upgrading Kysely

`WhereNode`, `TableNode`, `AliasNode`, `IdentifierNode`, and the whole
`OperationNodeTransformer` dispatch table are marked `@internal` in
Kysely's own source. There is no publicly documented plugin API for AST
rewriting — Kysely's official "Extending Kysely" docs cover simpler
`Expression`/`sql`-tag based extensions, not this. This plugin uses the
same mechanism Kysely's own bundled plugins (`CamelCasePlugin`,
`DeduplicateJoinsPlugin`) use internally, which lowers the practical risk —
Kysely breaking these nodes would break its own plugins too — but it is
**not a contract Kysely has committed to for third-party code**. The audit
plugin (`plugins/audit.ts`) depends on the same shared node-resolution
logic via `plugins/table-name.ts`, so a Kysely upgrade that breaks this
breaks both. If a Kysely upgrade changes behavior here, check this file's
(and `table-name.ts`'s) imports against the new version's
`src/operation-node/*` first.

## What it does *not* do

Be precise about these — silent gaps in a filter meant to prevent seeing
deleted data are exactly the kind of thing that bites in production.

- **`SELECT` and `UPDATE` are scoped; `.deleteFrom()` is not, and can't
  be.** An `UPDATE` against an already-soft-deleted row now affects 0 rows
  by default (the same `deleted_at IS NULL` filter SELECTs get), unless the
  query goes through `withDeleted()`. A raw `.deleteFrom()` is a different
  case entirely — see [below](#why-deletefrom-is-not-intercepted) for why
  that one genuinely can't be scoped by a plugin, not just "isn't yet."
- **Raw `sql` template literals bypass the plugin entirely.** Anything built
  with the `sql` tag is opaque to `OperationNodeTransformer` — there's no AST
  for it to rewrite. If you drop to raw SQL against a soft-delete table,
  you're back to writing the filter yourself.
- **It doesn't validate that `deletedAtColumn` actually exists on the
  table.** Misspell it in `createSoftDeletePlugin`'s options (or the column
  itself doesn't exist in the DB) and you'll get a runtime SQL error from
  Postgres, not a build-time or plugin-time one.

## Why `.deleteFrom()` is not intercepted

The obvious design — silently rewrite `db.deleteFrom("orders").where(...)`
into an `UPDATE ... SET deleted_at = now()` — doesn't work with Kysely's
plugin API. A `KyselyPlugin`'s `transformQuery` can rewrite nodes *within* a
query, but it can't change the query's **root operation kind**: a
`DeleteQueryNode` in, has to stay a `DeleteQueryNode` out. This was confirmed
against a real attempt to do exactly this (see
[kysely-org/kysely#803](https://github.com/kysely-org/kysely/issues/803)) —
the only way around it required replacing Kysely's `QueryExecutor` entirely,
a materially bigger and more invasive piece of machinery than a plugin.

So the write side is a separate, explicit function instead of AST
interception:

```ts
softDeleteUpdate(db, "orders", "deleted_at")
  .where("id", "=", orderId)
  .execute();
```

This is arguably better than silent rewriting would have been: it's obvious
at the call site that a soft delete is happening, rather than a `.deleteFrom()`
call quietly doing something a reader wouldn't expect from its name.

## The escape hatch: `withDeleted()`

```ts
withDeleted(db).selectFrom("orders").selectAll().execute();
```

`withDeleted(db)` is `db.withoutPlugins()` — a thin, one-line wrapper. It
turns off *every* plugin on the instance, not just soft delete. That
distinction is no longer hypothetical now that the [audit plugin](./audit.md)
exists: if a table has both `softDelete: true` and `audit: true`,
`withDeleted(db)` silences audit capture too, not just the soft-delete
filter — there's no more targeted "bypass only this one plugin" mechanism
today. Keep that in mind before reaching for `withDeleted()` on a table
that's also audited.

## API summary

| Function | Signature | What it does |
|---|---|---|
| `createSoftDeletePlugin` | `(options: { tables: string[]; deletedAtColumn?: string }) => KyselyPlugin` | The raw plugin, if you want to install it yourself rather than via `withSoftDelete` |
| `withSoftDelete` | `(db: Kysely<DB>, tables: Record<string, TableDefinition>) => Kysely<DB>` | Installs the plugin for every table with `softDelete: true`; returns `db` unchanged if none do |
| `withDeleted` | `(db: Kysely<DB>) => Kysely<DB>` | Bypasses all plugins (`db.withoutPlugins()`) |
| `softDeleteUpdate` | `(db, table, deletedAtColumn = "deleted_at") => UpdateQueryBuilder` | The write side — issues a real `UPDATE`, runs against `withDeleted(db)` internally |
