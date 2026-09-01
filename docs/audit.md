# Audit / CDC

Status: ✅ implemented (`packages/core/src/plugins/audit.ts`), tested with
real execution. `TableOptions.audit` existed as a documented-but-unused
option before this — this is its first real consumer.

## What it does

```ts
import { withAudit } from "@isthmica/core";

const db = withAudit(baseDb, tables, async (event) => {
  console.log(event.table, event.operation, event.newValues);
  // or: write to your own audit table, publish to Kafka, call a webhook —
  // this is deliberately unopinionated about the sink
});

await db.insertInto("orders").values({ status: "open" }).execute();
// sink is called with: { table: "orders", operation: "insert",
//                        occurredAt: Date, newValues: [{ id: 1, status: "open", ... }] }
```

Any table with `{ audit: true }` in its `table()` options gets INSERT,
UPDATE, and DELETE operations captured automatically and handed to `sink`.
`withAudit(db, tables, sink)` is a no-op (returns `db` unchanged) if no
table opts in.

## Scope: post-image only

Only the **new** row state (post-image) is captured — there is no
"before" value for UPDATE/DELETE. This is a deliberate boundary, not an
oversight: a `KyselyPlugin` hook operates on one query at a time with no
cross-query orchestration API, so capturing pre-image state needs either a
separate SELECT-then-mutate round trip (a materially bigger API shape than
a transparent plugin) or DB-native triggers/logical replication (outside
Kysely entirely). If pre-image capture is wanted later, the right design is
an explicit opt-in helper analogous to `softDeleteUpdate` — not a
transparent extension of this plugin.

## How it works

Two Kysely mechanisms, working together:

1. **`transformQuery`** injects `returning *` into INSERT/UPDATE/DELETE
   against an audited table — but only if the query hasn't already
   specified a narrower `.returning(...)`. A caller-narrowed
   `.returning(["id"])` is respected as written, which does narrow what
   gets audited too — a documented, **tested** limitation
   (`packages/core/test/audit.test.ts`), not a silent gap.
2. **`transformResult`** reads the resulting rows and calls `sink`,
   matched back to its originating query via a `WeakMap<QueryId, {table, operation}>`.

That WeakMap pattern is the load-bearing detail worth calling out: it's
**explicitly documented in Kysely's own `KyselyPlugin` JSDoc** as the
intended way to pass data between `transformQuery` and `transformResult` —
firmer ground than the soft-delete plugin's reliance on Kysely's
`@internal`-marked AST node factories (audit.ts uses those too, for table
resolution via the shared `extractTableRef` — see below — but the
query↔result matching itself rests on documented API).

### Shared with soft-delete: `plugins/table-name.ts`

`extractTableRef` (resolving a `TableNode`/`AliasNode` to its real name and
in-scope reference name — the same alias-safety logic
[`soft-delete.md`](./soft-delete.md) describes) was extracted out of
soft-delete.ts into a shared module once audit.ts needed the identical
logic for INSERT/UPDATE/DELETE table resolution. Pure refactor, no
behavior change to soft-delete.

## Dialect boundary

`RETURNING` is supported by Postgres and SQLite (≥3.35 — the
`better-sqlite3` version this project's tests use bundles 3.49.2) but
**not MySQL**. This plugin's capture mechanism is Postgres/SQLite-only for
now. Audit + MySQL (added as a `@isthmica/db-ops` backend — see
[`db-ops.md`](./db-ops.md)) is a separate, unbuilt design, not silently
assumed to work.

## Testing

`packages/core/test/audit.test.ts` — real SQLite execution, not
compile-only (this plugin's whole job is capturing real write results):

- Insert/update/delete against an audited table each produce exactly one
  correctly-shaped `sink` call.
- A non-audited table produces zero calls.
- A caller-narrowed `.returning(["status"])` narrows `newValues` to match —
  asserted directly, not just noted in a comment.
- `withAudit` is a no-op when no table declares `audit: true`.
