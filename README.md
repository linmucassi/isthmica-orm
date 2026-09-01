# Isthmica

A TypeScript ORM layer built on typed, declarative primitives for the things
every production team currently builds by hand: soft delete, audit/CDC,
tenant isolation, migrations, and partitioning.

> *Isthmica* (adj., from **isthmus**): the narrow connective layer between
> two larger bodies. An ORM's entire job is to be that narrow, well-engineered
> connection between application code and the database — this project takes
> that literally.

**Status: early-stage, actively growing.** The schema DSL, soft delete
(read *and* write scoping), audit/CDC, and a first slice of compile-time
tenant isolation are implemented and tested in `@isthmica/core`.
`@isthmica/db-ops` (connection helpers, CRUD ergonomics) and
`@isthmica/migrations` (DDL generation, schema diffing, partitioning) are
two further optional packages, also implemented and tested. Several pieces
are deliberately bounded first slices, not the full original vision — see
[`docs/roadmap.md`](./docs/roadmap.md) for exactly what's covered where,
and [`docs/known-risks.md`](./docs/known-risks.md) before betting anything
on a boundary you haven't checked.

## Why

The TypeScript ORM landscape (Drizzle, Prisma, Kysely, TypeORM/Sequelize)
has converged on solving typed SQL generation well. None of them ship
soft delete, audit/CDC, or tenant isolation as first-class, typed,
declarative primitives — every serious production codebase ends up building
these by hand instead. That's the gap Isthmica is built around, layered on
top of Kysely rather than competing with it. Full reasoning, including the
corrections made to the original pitch during review, is in
[`docs/background.md`](./docs/background.md).

## Quick example

```ts
import { table, text, serial, timestamp, withSoftDelete, withDeleted, softDeleteUpdate, type InferDatabase } from "@isthmica/core";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";

const orders = table(
  "orders",
  {
    id: serial("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    status: text("status").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  { softDelete: true },
);

const tables = { orders };
type DB = InferDatabase<typeof tables>;

const db = withSoftDelete(
  new Kysely<DB>({ dialect: new PostgresDialect({ pool: new Pool() }) }),
  tables,
);

// automatically scoped to deleted_at IS NULL — you don't write that filter
await db.selectFrom("orders").selectAll().where("status", "=", "open").execute();

// soft-deleting is explicit, not a rewritten .deleteFrom() — see docs/soft-delete.md for why
await softDeleteUpdate(db, "orders").where("id", "=", 1).execute();

// admin/support escape hatch: bypasses every plugin, including soft-delete scoping
await withDeleted(db).selectFrom("orders").selectAll().execute();
```

Walk through this end to end, including what each piece does and doesn't
cover, in [`docs/getting-started.md`](./docs/getting-started.md).

### Optional: less connection boilerplate with `@isthmica/db-ops`

The `Kysely`/`PostgresDialect`/`Pool` setup above is real, working code, but
it's the part that gets copy-pasted at every place a project builds a `db`
instance. `@isthmica/db-ops` is a separate, optional package that collapses
it into one call — `@isthmica/core` is completely unaffected either way:

```ts
import { pg, createRepository } from "@isthmica/db-ops";

const db = pg.connect<DB>({ connectionString: process.env.DATABASE_URL });
// same db instance you'd get from the manual setup above — withSoftDelete,
// withDeleted, softDeleteUpdate, hand-written queries, all work on it as-is

const orderRepo = createRepository(db, orders);
const order = await orderRepo.insert({ tenantId: "t_1", status: "open" });
await orderRepo.delete(order.id); // soft-deletes automatically — see docs/db-ops.md
```

`db-ops` also wires up Prisma-managed connections (`prisma.connect(...)`)
and MySQL (`mysql.connect(...)`, via `mysql2`) for projects that need
either. Full reference, including all three backends and the CRUD layer's
limits, in [`docs/db-ops.md`](./docs/db-ops.md).

### Audit and tenant isolation

```ts
import { withAudit, tenantScoped } from "@isthmica/core";

// post-image capture on INSERT/UPDATE/DELETE for any table with { audit: true }
const auditedDb = withAudit(db, tables, (event) => console.log(event));

// compile-time guarantee: this does not typecheck without .forTenant(...)
const myOrders = await tenantScoped(db, "orders", "tenant_id")
  .where("status", "=", "open")
  .forTenant(currentTenantId)
  .execute();
```

Both are real, tested first slices with explicit, documented boundaries —
audit is post-image only, tenant isolation covers single-table `SELECT`
only. See [`docs/audit.md`](./docs/audit.md) and
[`docs/tenant-isolation.md`](./docs/tenant-isolation.md) before relying on
either beyond that.

## Install

This is an npm-workspaces monorepo, not yet a published package (`isthmica`,
`isthmica-orm`, `isthmicadb`, `@isthmica/core`, `@isthmica/db-ops`, and
`@isthmica/migrations` are all confirmed unpublished on the npm registry as
of this writing). Clone and work inside the workspace:

```bash
git clone <repo-url> isthmica
cd isthmica
npm install
npm run typecheck
npm run test
```

Full requirements and layout: [`docs/installation.md`](./docs/installation.md).

## Documentation

| | |
|---|---|
| [`docs/background.md`](./docs/background.md) | Why this project exists — the ORM landscape, the competitive gap, the wedge |
| [`docs/installation.md`](./docs/installation.md) | Requirements, install steps, workspace layout |
| [`docs/getting-started.md`](./docs/getting-started.md) | Define a schema, wire it to Kysely, run your first soft-deleted query |
| [`docs/schema-dsl.md`](./docs/schema-dsl.md) | `column()` builders, `table()`, `InferDatabase` — full API reference |
| [`docs/soft-delete.md`](./docs/soft-delete.md) | How the soft-delete plugin works — read and write scoping, aliasing, the `.deleteFrom()` boundary |
| [`docs/audit.md`](./docs/audit.md) | Post-image audit/CDC capture on INSERT/UPDATE/DELETE |
| [`docs/tenant-isolation.md`](./docs/tenant-isolation.md) | The compile-time tenant-scoping guarantee — and its explicit single-table-`SELECT` boundary |
| [`docs/db-ops.md`](./docs/db-ops.md) | `@isthmica/db-ops` — optional connection setup (`pg`, `prisma`, `mysql`) and CRUD ergonomics (`createRepository`) |
| [`docs/migrations.md`](./docs/migrations.md) | `@isthmica/migrations` — DDL generation, schema diffing, diff application |
| [`docs/partitioning.md`](./docs/partitioning.md) | Declarative range partitioning + DDL |
| [`docs/architecture.md`](./docs/architecture.md) | Why it's built on Kysely, "no external engine process," and what that does and doesn't mean |
| [`docs/best-practices.md`](./docs/best-practices.md) | Practical guidance for the parts that exist today |
| [`docs/roadmap.md`](./docs/roadmap.md) | Phased plan, and what's actually shipped vs. still ahead |
| [`docs/known-risks.md`](./docs/known-risks.md) | The honest, currently-open risk register |

## What's implemented today

- **`@isthmica/core`** — schema DSL (`text`/`serial`/`timestamp` columns,
  `table()`, `InferDatabase`), soft delete (auto `deleted_at IS NULL`
  scoping on **both** reads and writes, an explicit `softDeleteUpdate()`
  for the soft-delete itself, a `withDeleted()` escape hatch), audit/CDC
  (post-image capture via `withAudit`), and a first slice of compile-time
  tenant isolation (`tenantScoped()` — single-table `SELECT` only).
- **`@isthmica/db-ops`** — optional, depends on `@isthmica/core` but
  nothing in `@isthmica/core` depends on it. Connection setup for `pg`
  (tested end-to-end), Prisma, and MySQL (both implemented, not
  integration-tested against a live server — see
  [`docs/known-risks.md`](./docs/known-risks.md)), plus a
  `createRepository()` CRUD layer (get/insert/update/delete).
- **`@isthmica/migrations`** — optional, depends on `@isthmica/core`,
  independent of `db-ops`. DDL generation from `table()` definitions,
  schema diffing, diff application, and declarative range partitioning —
  all a deliberately bounded first slice of the originally-planned
  migrations engine (no linter, no shadow-DB dry runs, no assisted
  rename-confirmation flow yet — see
  [`docs/migrations.md`](./docs/migrations.md)).

Still not built: an index advisor, schema branching, a type-safe
seed/fixture system, and a Studio-equivalent GUI. See
[`docs/roadmap.md`](./docs/roadmap.md) for the full phase-by-phase
breakdown, including exactly which "first slice" boundaries apply where.

## License

[Apache-2.0](./LICENSE).
