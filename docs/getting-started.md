# Getting started

This walks through everything that's actually implemented today: defining a
schema, wiring it to a real Kysely/Postgres connection, and using soft
delete. Every snippet below is runnable against the current
`@isthmica/core` API — nothing here is aspirational.

## 1. Install Kysely and a Postgres driver

`@isthmica/core` doesn't bundle a driver — you bring your own Kysely setup,
same as any Kysely project:

```bash
npm install kysely pg
npm install -D @types/pg
```

## 2. Define your schema

```ts
// schema.ts
import { table, text, serial, timestamp } from "@isthmica/core";

export const orders = table(
  "orders",
  {
    id: serial("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    status: text("status").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  { softDelete: true },
);

export const tenants = table("tenants", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
});

export const tables = { orders, tenants };
```

The third argument to `table()` — `{ softDelete: true }` — is the only table
option implemented today. `audit` and `partitionBy` are part of the planned
DSL surface (see [`roadmap.md`](./roadmap.md)) but do nothing yet if you set
them; there's no code that reads them.

**Before you point this at a real database:** `tenantId: text("tenant_id")`
above only works end-to-end if your actual Postgres column is named
`tenantId`, not `tenant_id` — the string passed to `text()` isn't wired to
query generation yet. Read
[`schema-dsl.md`'s naming note](./schema-dsl.md#a-naming-detail-object-key-vs-declared-column-name)
before choosing real column names; it explains both correct options (match
the object key to the DB column exactly, or install Kysely's own
`CamelCasePlugin`).

## 3. Build the Kysely `Database` type from your schema

```ts
// db.ts
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { withSoftDelete, type InferDatabase } from "@isthmica/core";
import { tables } from "./schema.js";

type DB = InferDatabase<typeof tables>;

const baseDb = new Kysely<DB>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: process.env.DATABASE_URL }),
  }),
});

// Installs the soft-delete plugin for every table that declared
// `softDelete: true` in its options. Tables that didn't are untouched —
// if none declared it, withSoftDelete returns `baseDb` unchanged.
export const db = withSoftDelete(baseDb, tables);
```

`InferDatabase` keys the resulting type by each table's **declared name**
(the first argument to `table()`), not by the object key you gave it in
`tables` — so `orders`/`tenants` above become `DB["orders"]`/`DB["tenants"]`
regardless of what you name the local bindings.

## 4. Read queries are scoped automatically

```ts
// only returns orders where deleted_at IS NULL — you don't write that filter
const openOrders = await db
  .selectFrom("orders")
  .selectAll()
  .where("status", "=", "open")
  .execute();

// joins are scoped too: any joined table that declared softDelete: true
// also gets its own deleted_at IS NULL filter, table-qualified
const withTenant = await db
  .selectFrom("orders")
  .innerJoin("tenants", "tenants.id", "orders.tenantId")
  .selectAll()
  .execute();
```

## 5. Seeing soft-deleted rows: the escape hatch

```ts
import { withDeleted } from "@isthmica/core";

// bypasses every Isthmica plugin for queries built from the returned
// instance — not just the soft-delete filter
const everyOrderIncludingDeleted = await withDeleted(db)
  .selectFrom("orders")
  .selectAll()
  .execute();
```

`withDeleted()` is a thin wrapper over Kysely's own `db.withoutPlugins()`. It
turns off *all* plugins registered on the instance, not just soft delete —
today that's the only plugin Isthmica installs, so the distinction doesn't
matter yet, but it will once audit/CDC plugins exist (see
[`roadmap.md`](./roadmap.md)).

## 6. Deleting a row — this is not `.deleteFrom()`

This is the part most likely to surprise you coming from another ORM's soft
delete config: **`db.deleteFrom("orders")` issues a real `DELETE`.** It is
not intercepted or rewritten. See
[`soft-delete.md`](./soft-delete.md#why-deletefrom-is-not-intercepted) for
why — short version, Kysely's plugin API cannot change a query's root
operation kind, so there's no way to make `.deleteFrom()` silently become an
`UPDATE`.

Soft-deleting a row is an explicit call instead:

```ts
import { softDeleteUpdate } from "@isthmica/core";

await softDeleteUpdate(db, "orders")
  .where("id", "=", orderId)
  .execute();

// SQL: update "orders" set "deleted_at" = $1 where "id" = $2
```

`softDeleteUpdate(db, table, deletedAtColumn?)` runs against
`withDeleted(db)` internally, so it can update a row regardless of whether
it's already (soft-)deleted. `deletedAtColumn` defaults to `"deleted_at"` —
pass a different string if your column is named something else.

## Next

- [`schema-dsl.md`](./schema-dsl.md) — full reference for `column()` builders, `table()`, and the inference types.
- [`soft-delete.md`](./soft-delete.md) — how the plugin actually rewrites queries, and its current limits.
- [`best-practices.md`](./best-practices.md) — patterns for testing, escape-hatch usage, and schema conventions.
