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
   — the same mechanism Kysely uses internally to let `Selectable<T>` /
   `Insertable<T>` / `Updateable<T>` derive different shapes for reads,
   inserts, and updates. Update currently reuses the insert type rather than
   having its own third type parameter threaded through — a deliberate MVP
   simplification, not a Kysely limitation.

## What's not here yet

- No `varchar`/`integer`/`boolean`/`jsonb`/etc. column types — only the three
  listed above exist. Adding more is mechanical (follow the same pattern as
  `text`/`serial`/`timestamp`) but hasn't been done.
- No foreign-key declaration syntax.
- No `partitionBy` option (Phase 3).
- No way to generate actual `CREATE TABLE` DDL from a `table()` definition —
  that's the migrations engine, not yet built (Phase 1).
