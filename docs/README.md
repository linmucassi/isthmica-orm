# Isthmica documentation

Isthmica is a TypeScript ORM layer built on typed, declarative primitives for
the things every production team currently builds by hand: soft delete,
audit/CDC, tenant isolation, migrations, and partitioning.

This folder is the source of truth for the project — why it exists, how it's
built, how to use what's implemented today, and what's still just a plan.
Every page distinguishes **✅ Implemented** from **📋 Planned** — nothing here
claims a feature exists unless it's in `packages/core/src` and covered by a
passing test.

## Start here

| Page | What it covers |
|---|---|
| [`background.md`](./background.md) | Why this project exists — the ORM landscape, the competitive gap, the wedge |
| [`installation.md`](./installation.md) | Requirements, install steps, workspace layout |
| [`getting-started.md`](./getting-started.md) | Define a schema, wire it to Kysely, run your first soft-deleted query |
| [`schema-dsl.md`](./schema-dsl.md) | `column()` builders, `table()`, `InferDatabase` — full API reference |
| [`soft-delete.md`](./soft-delete.md) | How the soft-delete plugin actually works, including the write-side caveat |
| [`db-ops.md`](./db-ops.md) | `@isthmica/db-ops` — optional connection setup (`pg`, `prisma`) and CRUD ergonomics (`createRepository`) |
| [`architecture.md`](./architecture.md) | Why it's built on Kysely, "no external engine process," and what that does and doesn't mean |
| [`best-practices.md`](./best-practices.md) | Practical guidance for the parts that exist today |
| [`roadmap.md`](./roadmap.md) | Phased plan, and what's actually shipped vs. still ahead |
| [`known-risks.md`](./known-risks.md) | The honest, currently-open risk register — read before betting a roadmap on any unimplemented feature |

## Current status, in one paragraph

As of this writing, `@isthmica/core` implements the schema DSL
(`text`/`serial`/`timestamp` columns, `table()`, `InferDatabase`) and the
soft-delete plugin (auto `deleted_at IS NULL` scoping on reads, an explicit
`softDeleteUpdate()` for writes, and a `withDeleted()` escape hatch).
`@isthmica/db-ops` is an **optional** second package built on top of it —
`pg`/`prisma` connection helpers and a thin `createRepository` CRUD layer —
that changes nothing about how `@isthmica/core` is used on its own. Beyond
those two packages: audit/CDC, tenant isolation, migrations, and
partitioning are designed (see [`roadmap.md`](./roadmap.md)) but not yet
built. If a page below describes something not in that list, it's marked
📋 Planned — treat it as intent, not as something you can `import` today.
