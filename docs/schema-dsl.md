# Schema DSL reference

Everything on this page is implemented in `packages/core/src/column.ts` and
`packages/core/src/table.ts`, and exported from `@isthmica/core`'s root
entry point.

## Column builders

```ts
import { text, serial, timestamp } from "@isthmica/core";
```

| Function | Select type | Insert type | Notes |
|---|---|---|---|
| `text(name)` | `string \| null` | `string \| null` | |
| `serial(name)` | `number` | `number \| undefined` | Not-null and has-default from the start — matches a Postgres `SERIAL`/auto-increment column, which is always generated |
| `timestamp(name)` | `Date \| null` | `Date \| null` | |

Every builder returns a `ColumnBuilder<TSelect, TInsert>` with two type
parameters tracked separately: what you get back from a `SELECT`, and what's
required (vs. optional) on an `INSERT`. This split is what lets a
`serial().primaryKey()` id be typed as `number` on read but *optional* on
write — the database generates it.

### Chainable modifiers

All three are immutable — each returns a **new** `ColumnBuilder`, it doesn't
mutate the one you called it on:

```ts
text("tenant_id").notNull()
// ColumnBuilder<string, string>  — null excluded from both select and insert

serial("id").primaryKey()
// ColumnBuilder<number, number | undefined>
// isPrimaryKey / isNotNull / hasDefault all become true

timestamp("created_at").defaultNow()
// ColumnBuilder<Date | null, Date | undefined>
// hasDefault becomes true — insert is optional, DB fills it in
```

`.notNull()` narrows by `Exclude<T, null>` on both type parameters.
`.primaryKey()` and `.defaultNow()` both add `| undefined` to the insert type
only — the select type is untouched, since reading the column back never
returns `undefined`.

### Runtime metadata

Beyond the type-level tracking, every `ColumnBuilder` carries plain runtime
fields: `name`, `dataType` (`"text" | "serial" | "timestamp"`),
`isPrimaryKey`, `isNotNull`, `hasDefault`. **Nothing in `@isthmica/core`
consumes these yet** — no migration generator, no DDL introspection exists
today (see [`roadmap.md`](./roadmap.md), Phase 1). They're populated now
because the migrations engine will need them, not because anything reads
them currently. Don't rely on them for application logic; they're there for
Isthmica's own future tooling.

### A naming detail: object key vs. declared column name

Read this before naming a column differently from its DB column, e.g.
`tenantId: text("tenant_id")`:

**The string passed to `text()`/`serial()`/`timestamp()` — the intended real
DB column name — is currently metadata only.** It's stored on
`ColumnBuilder.name` (see above), but nothing uses it to determine what
identifier Kysely's typed queries actually reference. That's the **object
key** you used in the `columns` record (`tenantId` in the example above),
because that's the key `InferRawTable`/`InferDatabase` carries through into
the `Database` type Kysely compiles queries against.

Concretely: `table("orders", { tenantId: text("tenant_id") })` produces a
Kysely `Database` type where the column is keyed `tenantId`, and
`db.selectFrom("orders").where("tenantId", "=", x)` compiles to
`where "tenantId" = $1` — **not** `where "tenant_id" = $1`. If your real
Postgres table has a column literally named `tenant_id`, that query
references a column that doesn't exist.

Two ways to actually get this right today:

1. **Make the object key match the real DB column name exactly** — e.g.
   `tenant_id: text("tenant_id")`, and reference it the same way everywhere
   (`.where("tenant_id", ...)`, `row.tenant_id`). Not idiomatic camelCase JS,
   but correct with zero extra setup.
2. **Install Kysely's own `CamelCasePlugin`** (`import { CamelCasePlugin } from "kysely"`,
   added to the `Kysely` constructor's `plugins` array) if you want camelCase
   JS keys over snake_case DB columns — it transforms outgoing identifiers
   and incoming result keys transparently. This is a real, official Kysely
   plugin, not something Isthmica wires in for you.

`@isthmica/core` doesn't currently do either of these automatically, and the
`name` argument existing without being load-bearing is genuinely easy to
misread as "this is the real column name, use whatever object key you like"
— it was misread exactly that way while writing this project's own docs and
tests before this note existed. See
[`known-risks.md`](./known-risks.md#discovered-while-building-db-ops).

## `table()`

```ts
import { table } from "@isthmica/core";

const orders = table(
  "orders",                              // declared table name
  {                                       // columns, keyed however you like
    id: serial("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    status: text("status").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  { softDelete: true },                  // options — see below
);
```

Signature: `table(name, columns, options?) => TableDefinition`.

### `TableOptions`

```ts
interface TableOptions {
  readonly softDelete?: boolean;
  readonly audit?: boolean;
}
```

- **`softDelete`** — ✅ implemented. Wiring this to `true` and passing the
  table through `withSoftDelete()` (see [`soft-delete.md`](./soft-delete.md))
  installs the read-scoping plugin for this table.
- **`audit`** — 📋 planned, not implemented. Setting it does nothing right
  now; there's no code anywhere that reads `options.audit`.

`partitionBy`, mentioned in the original project plan, isn't even in the
`TableOptions` type yet — it'll be added when partitioning
([`roadmap.md`](./roadmap.md), Phase 3) is actually built, not before.

### `TableDefinition`

```ts
interface TableDefinition<TName extends string, TColumns> {
  readonly name: TName;
  readonly columns: TColumns;
  readonly options: TableOptions;
  readonly $inferSelect: InferSelect<TColumns>;   // phantom, type-only
  readonly $inferInsert: InferInsert<TColumns>;   // phantom, type-only
}
```

`$inferSelect` and `$inferInsert` are never actually assigned a value at
runtime — accessing them at runtime returns `undefined`. They exist purely
so you can pull a row type out of a table definition without a separate
helper:

```ts
type Order = typeof orders.$inferSelect;
// { id: number; tenantId: string; status: string; createdAt: Date | null }
```

## `InferDatabase`

This is what bridges the schema DSL to Kysely's own typing:

```ts
import type { InferDatabase } from "@isthmica/core";

const tables = { orders, tenants };
type DB = InferDatabase<typeof tables>;

const db = new Kysely<DB>({ /* ... */ });
```

Two things worth knowing about how it resolves:

1. **The resulting keys come from each table's *declared* name** (the string
   passed as `table()`'s first argument), not from the property key you used
   in the `tables` object. `{ myOrders: orders }` still produces `DB["orders"]`
   if `orders` was declared as `table("orders", ...)`.
2. Each column is wrapped in Kysely's own `ColumnType<Select, Insert, Insert>`
   — Update currently reuses the Insert type rather than having its own
   third type parameter threaded through (a deliberate MVP simplification,
   not a Kysely limitation) — and `InferSelect`/`InferInsert`/`InferUpdate`
   (used for `$inferSelect`/`$inferInsert` and by `@isthmica/db-ops`'s
   `createRepository`) are Kysely's own `Selectable<T>`/`Insertable<T>`/
   `Updateable<T>` applied to that wrapped shape — not hand-rolled. An
   earlier version mapped every column straight through instead
   (`{ [K in keyof TColumns]: TColumns[K]["$insertType"] }`), which looked
   equivalent but wasn't: it made a DB-generated column's insert key
   *required-but-possibly-undefined* rather than *optional*, so
   `insert({ label: "x" })` failed to typecheck for a table with an
   auto-generated `id` — defeating the entire point of `.primaryKey()`
   making insert optional. Caught while building `@isthmica/db-ops`'s
   repository layer (see [`known-risks.md`](./known-risks.md#discovered-while-building-db-ops)),
   fixed by reusing Kysely's utilities instead of re-deriving the same
   logic worse.

## What's not here yet

- No `varchar`/`integer`/`boolean`/`jsonb`/etc. column types — only the three
  listed above exist. Adding more is mechanical (follow the same pattern as
  `text`/`serial`/`timestamp`) but hasn't been done.
- No foreign-key declaration syntax.
- No `partitionBy` option (Phase 3).
- No way to generate actual `CREATE TABLE` DDL from a `table()` definition —
  that's the migrations engine, not yet built (Phase 1).
