# Isthmica documentation

Isthmica is a TypeScript ORM layer built on typed, declarative primitives for
the things every production team currently builds by hand: soft delete,
audit/CDC, tenant isolation, migrations, and partitioning.

This folder is the source of truth for the project — why it exists, how it's
built, how to use what's implemented today, and what's still just a plan.
Every page distinguishes **✅ Implemented**, **🟡 First slice implemented**
(real, tested, but deliberately bounded — read the page for the boundary),
and **📋 Planned** — nothing here claims a feature exists, or claims more of
it exists than actually does, unless it's real code covered by a passing
test.

## Start here

| Page | What it covers |
|---|---|
| [`background.md`](./background.md) | Why this project exists — the ORM landscape, the competitive gap, the wedge |
| [`installation.md`](./installation.md) | Requirements, install steps, workspace layout |
| [`getting-started.md`](./getting-started.md) | Define a schema, wire it to Kysely, run your first soft-deleted query |
| [`schema-dsl.md`](./schema-dsl.md) | `column()` builders, `table()`, `InferDatabase` — full API reference |
| [`soft-delete.md`](./soft-delete.md) | How the soft-delete plugin works — read and write scoping, aliasing, the `.deleteFrom()` boundary |
| [`audit.md`](./audit.md) | Post-image audit/CDC capture on INSERT/UPDATE/DELETE |
| [`tenant-isolation.md`](./tenant-isolation.md) | The compile-time tenant-scoping guarantee — and its explicit single-table-`SELECT` boundary |
| [`db-ops.md`](./db-ops.md) | `@isthmica/db-ops` — optional connection setup (`pg`, `prisma`, `mysql`) and CRUD ergonomics (`createRepository`) |
| [`migrations.md`](./migrations.md) | `@isthmica/migrations` — DDL generation, schema diffing, diff application |
| [`partitioning.md`](./partitioning.md) | Declarative range partitioning + DDL — extends `migrations.md` |
| [`architecture.md`](./architecture.md) | Why it's built on Kysely, "no external engine process," and what that does and doesn't mean |
| [`best-practices.md`](./best-practices.md) | Practical guidance for the parts that exist today |
| [`roadmap.md`](./roadmap.md) | Phased plan, and what's actually shipped vs. still ahead |
| [`known-risks.md`](./known-risks.md) | The honest, currently-open risk register — read before betting a roadmap on any unimplemented feature |

## Current status, in one paragraph

`@isthmica/core` implements the schema DSL, soft delete (read *and* write
scoping), audit/CDC (post-image capture), and a first slice of compile-time
tenant isolation (single-table `SELECT` only). `@isthmica/db-ops` is an
**optional** second package — connection helpers for `pg`/`prisma`/`mysql`
and a thin `createRepository` CRUD layer. `@isthmica/migrations` is a third,
also optional, package — DDL generation, schema diffing, diff application,
and partitioning DDL. Neither optional package changes anything about how
`@isthmica/core` is used on its own. Still not built: the assisted
migration-rename confirmation flow, an index advisor, schema branching, a
seed/fixture system, and a Studio-equivalent GUI — see
[`roadmap.md`](./roadmap.md). If a page below describes something not
covered by real, tested code, it's marked 📋 Planned; if it describes a real
but deliberately narrow first slice, it's marked 🟡 — read that page's scope
section before assuming broader coverage than it states.
