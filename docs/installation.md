# Installation

## Requirements

- **Node.js** 20 or later (developed against v24).
- **Postgres.** `@isthmica/core`'s only supported dialect (see
  [`architecture.md`](./architecture.md)). `@isthmica/db-ops` additionally
  offers a MySQL connection backend (`mysql.connect`, compile-only tested,
  not verified against a live MySQL server) and a Prisma-backed one — see
  [`db-ops.md`](./db-ops.md).
- **Kysely** `^0.29.0` as a peer dependency. `@isthmica/core` builds directly
  on Kysely's query builder and plugin API rather than replacing it (see
  [`architecture.md`](./architecture.md)), so you install and configure
  Kysely yourself, the same way you would for any Kysely project.

`@isthmica/core` pins its own dev/test dependency on Kysely `^0.29.5`
specifically — earlier 0.28.x releases have known SQL-injection advisories,
patched in 0.29.5. Don't pin below that in a consuming project either.

## This is a monorepo, not yet a published package

As of this writing, `isthmica`, `isthmica-orm`, `isthmicadb`,
`@isthmica/core`, `@isthmica/db-ops`, and `@isthmica/migrations` are all
unpublished (verified against the npm registry directly — all return HTTP
404). There is nothing to `npm install` from a registry yet. To work with
the project, clone it and work inside the workspace:

```bash
git clone <repo-url> isthmica
cd isthmica
npm install
```

This installs dependencies for every package under `packages/*` in one pass
— it's an [npm workspaces](https://docs.npmjs.com/cli/v10/using-npm/workspaces)
monorepo, not a pnpm one. (pnpm wasn't available in the environment this
project was scaffolded in; npm workspaces do the same job at this project's
current size with no extra tooling to install. Revisit if/when the monorepo
grows enough that pnpm's stricter dependency isolation starts to matter.)

## Layout

```
isthmica/
├── package.json          # workspace root — npm workspaces config
├── tsconfig.base.json     # shared compiler options, extended by every package
├── LICENSE                # Apache-2.0
└── packages/
    ├── core/              # @isthmica/core — schema DSL, soft delete, audit, tenant isolation (implemented)
    │   ├── src/
    │   ├── test/
    │   ├── package.json
    │   ├── tsconfig.json
    │   └── tsup.config.ts
    ├── db-ops/            # @isthmica/db-ops — optional: pg/prisma/mysql connect + CRUD (implemented)
    │   ├── src/
    │   ├── test/
    │   ├── package.json
    │   ├── tsconfig.json
    │   └── tsup.config.ts
    └── migrations/        # @isthmica/migrations — optional: DDL generation, schema diff/apply, partitioning (implemented)
        ├── src/
        ├── test/
        ├── package.json
        ├── tsconfig.json
        └── tsup.config.ts
```

`@isthmica/db-ops` and `@isthmica/migrations` both depend on
`@isthmica/core` (resolved via npm workspaces to the local package, not the
registry) but are entirely optional — nothing in `@isthmica/core` depends
on either, and using `@isthmica/core` on its own works exactly as
documented regardless of which (if any) of the other two are installed.
See [`db-ops.md`](./db-ops.md) and [`migrations.md`](./migrations.md).

Future packages (a CLI, a second core dialect, etc.) will land as
additional `packages/*` entries as they're built — see
[`roadmap.md`](./roadmap.md).

## Workspace-level scripts

Run from the repo root; each fans out to every package that defines the
matching script:

```bash
npm run build       # tsup — builds dual ESM/CJS + .d.ts output to packages/*/dist
npm run test        # vitest run
npm run typecheck   # tsc --noEmit
```

## Verifying your setup

```bash
npm install
npm run typecheck
npm run test
```

You should see all three packages' test suites pass — a mix of compile-only
tests (asserting on compiled SQL text, no live database required) and
real-execution tests against an in-memory SQLite database (no live Postgres
required either); see
[`best-practices.md`](./best-practices.md#testing-without-a-live-database)
for which pattern is used where and why.
