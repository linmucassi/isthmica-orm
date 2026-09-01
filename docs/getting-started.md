# Getting started

This walks through the core workflow: defining a schema, wiring it to a
real Kysely/Postgres connection, and using soft delete. Every snippet below
is runnable against the current `@isthmica/core` API — nothing here is
aspirational. Audit, tenant isolation, and migrations each get their own
focused page (linked at the bottom) rather than being folded in here.

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

`{ softDelete: true }` is one of three implemented `table()` options —
`audit` (see [`audit.md`](./audit.md)) and `partitionBy` (see
[`partitioning.md`](./partitioning.md)) are the other two.

**Naming note:** `tenantId: text("tenant_id")` above — object key
`tenantId`, declared name `tenant_id` — is the normal case, and it's
handled correctly: Kysely's typed queries (and `@isthmica/db-ops`'s
`createRepository`) reference the column by its *declared* name
(`tenant_id`), while `$inferSelect`/`$inferInsert` and `createRepository`'s
public shape stay keyed by the *object key* (`tenantId`) for JS-side
ergonomics. See
[`schema-dsl.md`'s naming section](./schema-dsl.md#object-key-vs-declared-column-name--resolved)
for the full explanation of that split, including why it's two separate
things rather than one.

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
// also gets its own deleted_at IS NULL filter, table-qualified.
// Note the join condition references "orders.tenant_id" — the declared
// column name, not the "tenantId" object key (see the naming note above).
const withTenant = await db
  .selectFrom("orders")
  .innerJoin("tenants", "tenants.id", "orders.tenant_id")
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
if a table also has `audit: true` (see [`audit.md`](./audit.md)),
`withDeleted()` silences audit capture on it too. There's no more targeted
"bypass just this one plugin" mechanism yet.

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

// SQL: update "orders" set "deleted_at" = current_timestamp where "id" = $1
// (current_timestamp is a SQL expression, not a bound parameter — see
// soft-delete.md for why it's not a JS Date)
```

`softDeleteUpdate(db, table, deletedAtColumn?)` runs against
`withDeleted(db)` internally, so it can update a row regardless of whether
it's already (soft-)deleted. `deletedAtColumn` defaults to `"deleted_at"` —
pass a different string if your column is named something else.

## Next

- [`schema-dsl.md`](./schema-dsl.md) — full reference for `column()` builders, `table()`, and the inference types.
- [`soft-delete.md`](./soft-delete.md) — how the plugin actually rewrites queries, and its current limits.
- [`audit.md`](./audit.md) — post-image capture on INSERT/UPDATE/DELETE.
- [`tenant-isolation.md`](./tenant-isolation.md) — the compile-time tenant-scoping guarantee.
- [`migrations.md`](./migrations.md) — generating DDL and diffing schemas from `table()` definitions.
- [`best-practices.md`](./best-practices.md) — patterns for testing, escape-hatch usage, and schema conventions.
