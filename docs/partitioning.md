# Partitioning

Status: 🟡 **first slice implemented** (`TableOptions.partitionBy` in
`@isthmica/core`, DDL generation in `@isthmica/migrations`), compile-only
tested — **not verified against a live Postgres**, since none exists
anywhere in this project's test suite. Same honesty bar already applied to
the soft-delete plugin: implemented-per-documentation, not
execution-verified. Read [`migrations.md`](./migrations.md) first — this
extends `generateCreateTable` rather than duplicating it.

## What it does

```ts
import { table, serial, timestamp } from "@isthmica/core";
import { generateCreateTable, generateRangePartition } from "@isthmica/migrations";

const events = table(
  "events",
  { id: serial("id").primaryKey(), occurredAt: timestamp("created_at").notNull() },
  { partitionBy: { type: "range", column: "created_at", interval: "month" } },
);

// CREATE TABLE "events" (...) partition by range ("created_at")
await generateCreateTable(db, events).execute();

// CREATE TABLE "events_2026_01" PARTITION OF "events" FOR VALUES FROM (...) TO (...)
await generateRangePartition("events", {
  name: "events_2026_01",
  from: new Date("2026-01-01T00:00:00.000Z"),
  to: new Date("2026-02-01T00:00:00.000Z"),
}).execute(db);
```

## Scope

- **`range` partitioning only, monthly interval only.** No `list`/`hash`
  variants.
- **Postgres only.** `generateCreateTable` throws (doesn't silently ignore
  `partitionBy`) if called with `dialect: "sqlite"` against a partitioned
  table — SQLite has no partitioning support at all.
- **No automatic partition lifecycle management.** Nothing pre-creates
  next month's partition or drops old ones on a schedule.
  `generateRangePartition` creates exactly **one** partition per call, on
  demand. This is real infrastructure requiring a scheduler, which doesn't
  exist anywhere in this project — genuinely out of scope, not deferred by
  accident.
- **No online conversion** from an existing unpartitioned table to a
  partitioned one. Not attempted.

## How it's built

`generateCreateTable` (in `@isthmica/migrations`, see
[`migrations.md`](./migrations.md)) appends the `PARTITION BY RANGE`
clause via Kysely's `CreateTableBuilder.modifyEnd()` — the documented,
public hook for exactly this ("adds any additional SQL to the end of the
query," per its own JSDoc example). This was confirmed to be the right
hook by scanning `CreateTableBuilder`'s full method list: there's no
dedicated partition-declaration method.

`generateRangePartition` builds `CREATE TABLE ... PARTITION OF ... FOR
VALUES FROM ... TO ...` using Kysely's `sql` tag directly — **not** a
schema-builder method, because none exists for this at all (also confirmed
by scanning, not assumed). This is a deliberate, verified exception to
"prefer the builder over hand-formatted SQL": the `sql` tag is stable,
public API (unlike the `@internal`-marked AST node factories the
soft-delete and audit plugins rely on), so reaching for it here isn't the
same category of risk as those.

## Testing

Compile-only (`packages/migrations/test/partition.test.ts`) — no live
Postgres exists anywhere in this project, and Postgres is the only dialect
`partitionBy` supports:

- `generateCreateTable` appends `partition by range ("created_at")` for a
  table that declares `partitionBy`.
- It throws (doesn't silently produce wrong SQL) for `dialect: "sqlite"`.
- A table without `partitionBy` is unaffected.
- `generateRangePartition` compiles the expected `CREATE TABLE ... PARTITION
  OF ...` shape with the right parameters.

If you use this against real Postgres, treat it as the first real
verification it's had — and consider reporting back what you find, since
`known-risks.md` currently lists this as unverified.
