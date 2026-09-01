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

Every builder returns a `ColumnBuilder<TName, TSelect, TInsert>` with three
type parameters: `TName` is the declared column name as a string literal
type (the actual argument you passed in — this is what lets
`InferRawTable` key Kysely's `Database` type by the real column name, not
by whatever object key you happen to store the builder under — see
[`InferDatabase`](#inferdatabase) below); `TSelect`/`TInsert` track what
you get back from a `SELECT` and what's required (vs. optional) on an
`INSERT` separately. That split is what lets a `serial().primaryKey()` id
be typed as `number` on read but *optional* on write — the database
generates it.

### Chainable modifiers

All three are immutable — each returns a **new** `ColumnBuilder`, it doesn't
mutate the one you called it on:

```ts
text("tenant_id").notNull()
// ColumnBuilder<"tenant_id", string, string>  — null excluded from both select and insert

serial("id").primaryKey()
// ColumnBuilder<"id", number, number | undefined>
// isPrimaryKey / isNotNull / hasDefault all become true

timestamp("created_at").defaultNow()
// ColumnBuilder<"created_at", Date | null, Date | undefined>
// hasDefault becomes true — insert is optional, DB fills it in
```

`.notNull()` narrows by `Exclude<T, null>` on both type parameters.
`.primaryKey()` and `.defaultNow()` both add `| undefined` to the insert type
only — the select type is untouched, since reading the column back never
returns `undefined`.

### Runtime metadata

Beyond the type-level tracking, every `ColumnBuilder` carries plain runtime
fields: `name`, `dataType` (`"text" | "serial" | "timestamp"`),
`isPrimaryKey`, `isNotNull`, `hasDefault`. These now have a real consumer:
`@isthmica/migrations`' `generateCreateTable` reads all five to drive
Kysely's schema builder — see [`migrations.md`](./migrations.md), including
a documented heuristic limit on how `hasDefault` is currently interpreted.
Don't rely on them for other application logic beyond that; the exact set
of fields is shaped by what DDL generation needs, not a general
introspection API.

### Object key vs. declared column name — resolved

An earlier version of this DSL stored the string passed to
`text()`/`serial()`/`timestamp()` as metadata only, without wiring it into
query generation — Kysely's typed queries referenced the **object key**
(`tenantId`) instead of the **declared name** (`tenant_id`), silently
producing SQL that referenced a column that might not exist. Fixed: see
[`known-risks.md`](./known-risks.md#fixed--closed-not-just-documented).

**Current, correct behavior:** `ColumnBuilder`'s `TName` type parameter
(see [above](#column-builders)) carries the declared name as a literal
type, and `InferRawTable` (which `InferDatabase` uses) keys Kysely's raw
`Database` type by it. So `table("orders", { tenantId: text("tenant_id") })`
produces a `Database` type where the column is keyed `tenant_id`, and
`db.selectFrom("orders").where("tenant_id", "=", x)` — using the *declared
name*, not the object key — is what actually typechecks and compiles
correctly.

**`InferSelect`/`InferInsert`/`InferUpdate` (JS-facing — `$inferSelect`,
`$inferInsert`, and `@isthmica/db-ops`'s `createRepository`) deliberately
stay keyed by object key**, not declared name — see
[`InferDatabase`](#inferdatabase) below for why that split exists and how
it's kept correct.

If you want camelCase JS keys over snake_case DB columns at the raw Kysely
query level too (not just through `@isthmica/db-ops`'s repository layer,
which already handles this translation for you), install Kysely's own
`CamelCasePlugin` (`import { CamelCasePlugin } from "kysely"`, added to the
`Kysely` constructor's `plugins` array) — a real, official Kysely plugin,
not something Isthmica wires in for you.

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
  readonly partitionBy?: {
    readonly type: "range";
    readonly column: string;
    readonly interval: "month";
  };
}
```

- **`softDelete`** — ✅ implemented. Wiring this to `true` and passing the
  table through `withSoftDelete()` (see [`soft-delete.md`](./soft-delete.md))
  installs the read-and-write-scoping plugin for this table.
- **`audit`** — ✅ implemented. Wiring this to `true` and passing the table
  through `withAudit()` (see [`audit.md`](./audit.md)) captures
  post-image INSERT/UPDATE/DELETE events for this table.
- **`partitionBy`** — 🟡 first slice implemented, range/monthly only,
  Postgres-only, consumed by `@isthmica/migrations`' `generateCreateTable`
  (`@isthmica/core` itself has no DDL generation — see
  [`partitioning.md`](./partitioning.md)). `column` is the column's
  *declared* name, same convention as everywhere else on this page — not
  the object key.

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

Three things worth knowing about how it resolves — two are stable design,
one is a bug fix worth understanding so it doesn't regress:

1. **The resulting keys come from each table's *declared* name** (the string
   passed as `table()`'s first argument), not from the property key you used
   in the `tables` object. `{ myOrders: orders }` still produces `DB["orders"]`
   if `orders` was declared as `table("orders", ...)`.
2. **Within a table, `InferRawTable` — what `InferDatabase` actually
   uses — keys each column by its *declared name* too** (`tenant_id`, not
   `tenantId`; see [above](#object-key-vs-declared-column-name--resolved)),
   wrapping each in Kysely's own `ColumnType<Select, Insert, Insert>`
   (Update currently reuses the Insert type rather than having its own
   third type parameter threaded through — a deliberate MVP simplification,
   not a Kysely limitation).
3. **`InferSelect`/`InferInsert`/`InferUpdate` — used for `$inferSelect`/
   `$inferInsert` and by `@isthmica/db-ops`'s `createRepository` — are a
   *separate* mapped type from `InferRawTable`, keyed by object key, not
   derived from it.** This split is deliberate and was the site of a real
   bug: an early version of the declared-name fix derived
   `InferSelect`/`InferInsert`/`InferUpdate` directly from `InferRawTable`
   (via `Selectable<InferRawTable<T>>` etc.), which silently re-keyed them
   by declared name too — breaking `@isthmica/db-ops`'s repository tests
   immediately (caught by `tsc`, not a runtime surprise). Fixed by giving
   `InferSelect`/`InferInsert`/`InferUpdate` their own object-key-keyed
   intermediate type (`InferObjectKeyedRawTable` in `table.ts`), applying
   Kysely's `Selectable`/`Insertable`/`Updateable` to *that* instead. Those
   utilities are still the right tool here — reusing them (rather than a
   hand-rolled mapped type) is what makes a DB-generated column's insert
   key correctly *optional* rather than *required-but-possibly-undefined*,
   which was a separate, earlier bug in the same area. See
   [`known-risks.md`](./known-risks.md#fixed--closed-not-just-documented)
   for both.

## What's not here yet

- No `varchar`/`integer`/`boolean`/`jsonb`/etc. column types — only the three
  listed above exist. Adding more is mechanical (follow the same pattern as
  `text`/`serial`/`timestamp`) but hasn't been done.
- No foreign-key declaration syntax.
- No `list`/`hash` partitioning (only `range`/monthly — see
  [`partitioning.md`](./partitioning.md)).
- `@isthmica/core` itself still has no DDL generation — `generateCreateTable`
  lives in the separate `@isthmica/migrations` package (see
  [`migrations.md`](./migrations.md)), not here.
