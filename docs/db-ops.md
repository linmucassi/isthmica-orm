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
npm install mysql2                                          # for the mysql backend
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

## MySQL backend

```ts
import { mysql } from "@isthmica/db-ops";

const db = await mysql.connect<DB>({ host: "localhost", user: "root", database: "app" });
```

Mirrors the `pg` backend exactly — `mysql.pool(options)` for just the pool,
`mysql.connect(options)` (or `mysql.connect({ pool: existingPool })`) for
the full `Kysely` instance — via Kysely's own `MysqlDialect` paired with
`mysql2`, the standard combination. `options` is `mysql2`'s own
`PoolOptions` type, passed straight through, same "don't reinvent
credential configuration" approach as `pg`.

Both `mysql.pool` and `mysql.connect` are `async`, unlike `pg`'s — `mysql2`
is loaded via dynamic `import()`, the same reasoning `prisma.ts` already
uses: `mysql2` is a genuinely optional add-on, and a static import would
force it to be installed just to import *anything* from
`@isthmica/db-ops`, even code that never touches MySQL. (`pg` doesn't get
this treatment, since it's the assumed default dialect throughout this
project's docs — see [`known-risks.md`](./known-risks.md) for that
asymmetry, tracked honestly rather than silently left inconsistent.)

**Not verified against a live MySQL server** — only compile-only tested
(no MySQL instance exists anywhere in this project). See
[`known-risks.md`](./known-risks.md).

## `isthmica` default export

```ts
import isthmica from "@isthmica/db-ops";

const db = isthmica.pg.connect<DB>({ connectionString: process.env.DATABASE_URL });
```

`@isthmica/db-ops`'s default export bundles every backend namespace
(`pg`, `prisma`, `mysql`) into one object, for projects that prefer one
import over several named ones. The named exports (`pg`, `prisma`,
`mysql`) work identically — use whichever reads better in your codebase.

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

### Object key vs. declared column name — handled for you here

Every `Repository` method's public shape (`get`/`insert`/`update`'s
parameters and return values) is **object-key-shaped** (`tenantId`), the
same as `$inferSelect`/`$inferInsert` elsewhere in this doc set — even
though the underlying Kysely queries `createRepository` builds internally
reference each column's *declared* name (`tenant_id`; see
[`schema-dsl.md`](./schema-dsl.md#object-key-vs-declared-column-name--resolved)
for the full explanation of that split). `createRepository` translates
between the two at its boundary (`toRawRecord`/`fromRawRow` internally) so
you never have to think about it: pass and receive `tenantId`, regardless
of what the real column is named.

The primary-key `primaryKey` option (above) is the one place this still
surfaces directly — it's specified by object key (`{ primaryKey: "orderId" }`),
not declared name, matching every other `Repository` boundary.

## Testing

`@isthmica/db-ops`'s own test suite (`packages/db-ops/test`) uses different
approaches per module, matching what each actually needs:

- `pg.test.ts` / `mysql.test.ts` — compile-only, same pattern as
  `@isthmica/core`'s tests (see
  [`best-practices.md`](./best-practices.md#testing-without-a-live-database)):
  a pool that's never connected, asserting on compiled SQL text.
  `mysql.test.ts` specifically asserts on *dialect-specific* differences
  (backtick identifier quoting, `?` placeholders) rather than just "it
  compiles," so it isn't a copy-paste of the pg test that happens to pass.
- `repository.test.ts` — a **real, executed** round trip (insert → get →
  update → delete) against an in-memory SQLite database via
  `better-sqlite3`. The test creates its own schema directly via Kysely's
  schema builder rather than from the `table()` definitions — `db-ops`
  deliberately doesn't depend on `@isthmica/migrations` for this, keeping
  the two optional packages independent of each other. This is what
  actually caught real bugs while this package was being built — see
  [`known-risks.md`](./known-risks.md#fixed--closed-not-just-documented) —
  none of which a compile-only test would have surfaced, since they were
  all about runtime values or execution-time SQL validity, not query shape.

There's no test exercising the Prisma backend, for the reason stated above:
no generated Prisma client exists in this repo to test against. Similarly,
no live MySQL server exists to integration-test the `mysql` backend beyond
its compile-only tests.
