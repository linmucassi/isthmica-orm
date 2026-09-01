# `@isthmica/db-ops` — optional connection & CRUD ergonomics

Status: ✅ implemented (`packages/db-ops/src`), fully optional. `@isthmica/core`
works exactly as documented elsewhere in this folder with or without this
package installed — nothing in `@isthmica/core` depends on or changes
behavior based on `@isthmica/db-ops` being present.

## What problem this solves

The [`getting-started.md`](./getting-started.md) setup is correct but verbose,
and gets repeated at every place a project builds a `Kysely` instance:

```ts
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";

const db = new Kysely<DB>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: process.env.DATABASE_URL }),
  }),
});
```

`@isthmica/db-ops` collapses that into one call per supported backend, and
adds a thin CRUD layer (get/insert/update/delete) so most call sites don't
hand-write `selectFrom`/`insertInto`/`updateTable` shapes for simple
single-row operations either.

## Install

```bash
npm install @isthmica/db-ops
```

Backend-specific packages are **optional peer dependencies** — installing
`@isthmica/db-ops` alone pulls in nothing beyond `@isthmica/core` and
Kysely. Add the ones you actually use:

```bash
npm install pg                                              # for the pg backend
npm install @prisma/client @prisma/adapter-pg prisma-extension-kysely  # for the prisma backend
```

The Prisma-backed path additionally requires Prisma 7+ (its driver-adapters
architecture) and `prisma-extension-kysely` v4+ — see
[the Prisma section below](#prisma-backend) before reaching for it.

## The `pg` backend

```ts
import { pg } from "@isthmica/db-ops";
import type { InferDatabase } from "@isthmica/core";

type DB = InferDatabase<typeof tables>;

const db = pg.connect<DB>({ connectionString: process.env.DATABASE_URL });
```

`pg.connect<DB>(options)` is the actual boilerplate-reduction win — it
replaces the full `Pool` + `PostgresDialect` + `Kysely` construction with one
call, and returns a plain `Kysely<DB>`, so everything else in this doc set
(`withSoftDelete`, `withDeleted`, `softDeleteUpdate`, hand-written queries)
works on it exactly as documented — `db-ops` doesn't wrap or replace the
`Kysely` instance with something else.

`options` is `pg`'s own `PoolConfig` type, passed straight through — a
connection string, or discrete credential fields (`host`/`port`/`user`/
`password`/`database`), plus pool tuning (`max`, `idleTimeoutMillis`, `ssl`,
...). Isthmica doesn't reinvent credential configuration; whatever `pg`
already accepts, `pg.connect` accepts.

If you want the raw pool too (e.g. to share it with non-Kysely `pg` code
elsewhere in the app), `pg.pool(options)` returns just that, and
`pg.connect({ pool: existingPool })` accepts an already-built one instead of
building its own.

```ts
import { pg } from "@isthmica/db-ops";

const pool = pg.pool({ connectionString: process.env.DATABASE_URL });
const db = pg.connect<DB>({ pool });
```

## Prisma backend

```ts
import { prisma } from "@isthmica/db-ops";

const db = await prisma.connect<DB>({ connectionString: process.env.DATABASE_URL });
```

This wires Kysely to run through **Prisma's own connection** — via
`@prisma/adapter-pg` and the community package
[`prisma-extension-kysely`](https://github.com/eoin-obrien/prisma-extension-kysely)
— so a project that's already configuring credentials and pooling through
Prisma doesn't need a second, separate `pg.Pool` just for Isthmica. Queries
still go through Kysely / Isthmica exactly like the `pg` backend — this
isn't "use Prisma's ORM," it's "use Prisma's connection management, keep
Isthmica's typed query layer."

Note this is `async` (`pg.connect` isn't) — connecting through
`PrismaClient` requires awaiting its setup.

**Read this before relying on it in production:** this implementation is
built against `prisma-extension-kysely`'s documented v4 API and Prisma 7's
driver-adapter requirement, verified against the package's own README — but
it has **not been exercised against a live Prisma + Postgres setup**, since
this repository has no generated Prisma client to test against. Treat it as
implemented-per-documentation, not integration-tested, and see
[`known-risks.md`](./known-risks.md).

`@prisma/client`, `@prisma/adapter-pg`, and `prisma-extension-kysely` are
loaded via dynamic `import()` inside `prisma.connect()` — requiring
`@isthmica/db-ops` doesn't eagerly load any of them, so a project using only
the `pg` backend never touches Prisma's toolchain at all.

## `isthmica` default export

```ts
import isthmica from "@isthmica/db-ops";

const db = isthmica.pg.connect<DB>({ connectionString: process.env.DATABASE_URL });
```

`@isthmica/db-ops`'s default export bundles every backend namespace
(`pg`, `prisma`) into one object, for projects that prefer one import over
several named ones. The named exports (`pg`, `prisma`) work identically —
use whichever reads better in your codebase.

`@isthmica/db-ops` also re-exports everything `@isthmica/core` exports, so
a project using both packages can import from just one place:

```ts
import { table, text, serial, withSoftDelete, pg, createRepository } from "@isthmica/db-ops";
```

This is purely additive — `@isthmica/core` remains directly importable on
its own, unaffected either way.

## CRUD ergonomics: `createRepository`

```ts
import { pg, createRepository } from "@isthmica/db-ops";
import { table, text, serial, timestamp } from "@isthmica/core";

const orders = table(
  "orders",
  {
    id: serial("id").primaryKey(),
    status: text("status").notNull(),
    createdAt: timestamp("createdAt").defaultNow(),
  },
  { softDelete: true },
);

const db = pg.connect<InferDatabase<{ orders: typeof orders }>>({ /* ... */ });
const orderRepo = createRepository(db, orders);

const order = await orderRepo.insert({ status: "open" });   // id is optional — DB-generated
await orderRepo.get(order.id);
await orderRepo.update(order.id, { status: "shipped" });
await orderRepo.delete(order.id);                            // soft-deletes: see below
```

Four methods, deliberately not more — `get`, `insert`, `update`, `delete`.
This is a convenience layer over straightforward Kysely queries, not a new
query capability: reach for `db` directly for anything involving filtering,
joins, or pagination. `insert`/`update`/`get`'s types come straight from
`@isthmica/core`'s `InferInsert`/`InferUpdate`/`InferSelect` — a
DB-generated column (`.primaryKey()`, `.defaultNow()`) is correctly optional
on `insert`, not required.

### `delete` is soft-delete-aware

If the table passed to `createRepository` declared `softDelete: true`,
`.delete(id)` calls `@isthmica/core`'s `softDeleteUpdate` internally — a
real `UPDATE ... SET deleted_at = current_timestamp`, not a `DELETE`. For a
table without `softDelete`, it's a real `DELETE`. See
[`soft-delete.md`](./soft-delete.md) for why soft delete's write side works
this way.

### Choosing the primary key

```ts
createRepository(db, orders);                          // defaults to the "id" column
createRepository(db, orders, { primaryKey: "orderId" }); // explicit, if it isn't "id"
```

Isthmica doesn't track "is this the primary key" at the type level — only
as runtime metadata on each column. `createRepository` defaults to a column
literally keyed `"id"` and throws immediately (at creation time, not on
first use) if you pass a `primaryKey` that doesn't exist on the table.
Composite keys aren't supported — pick the single column that uniquely
identifies a row for `get`/`update`/`delete` purposes.

### A naming detail that matters here specifically

`get`/`update`/`delete` reference columns by their **object key** in the
`table()` definition (e.g. `id`), not by the string passed to
`text()`/`serial()`/etc. — see the naming note in
[`schema-dsl.md`](./schema-dsl.md#a-naming-detail-object-key-vs-declared-column-name)
for why, and what to do if your DB columns are named differently from your
JS object keys.

## Testing

`@isthmica/db-ops`'s own test suite (`packages/db-ops/test`) uses two
different approaches, matching what each module actually needs:

- `pg.test.ts` — compile-only, same pattern as `@isthmica/core`'s tests
  (see [`best-practices.md`](./best-practices.md#testing-without-a-live-database)):
  a `pg.Pool` that's never connected, asserting on compiled SQL text.
- `repository.test.ts` — a **real, executed** round trip (insert → get →
  update → delete) against an in-memory SQLite database via
  `better-sqlite3`. Isthmica has no migrations engine yet, so the test
  creates its own schema directly via Kysely's schema builder rather than
  from the `table()` definitions. This is what actually caught two real
  bugs while this package was being built — see
  [`known-risks.md`](./known-risks.md#discovered-while-building-db-ops) —
  neither of which a compile-only test would have surfaced, since both were
  about runtime values (a missing optional-property split, an
  unbindable `Date`), not query shape.

There's no test exercising the Prisma backend, for the reason stated above:
no generated Prisma client exists in this repo to test against.
