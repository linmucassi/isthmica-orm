# Installation

## Requirements

- **Node.js** 20 or later (developed against v24).
- **Postgres.** The only dialect implemented so far — see
  [`roadmap.md`](./roadmap.md) for MySQL/SQLite.
- **Kysely** `^0.29.0` as a peer dependency. `@isthmica/core` builds directly
  on Kysely's query builder and plugin API rather than replacing it (see
  [`architecture.md`](./architecture.md)), so you install and configure
  Kysely yourself, the same way you would for any Kysely project.

`@isthmica/core` pins its own dev/test dependency on Kysely `^0.29.5`
specifically — earlier 0.28.x releases have known SQL-injection advisories,
patched in 0.29.5. Don't pin below that in a consuming project either.

## This is a monorepo, not yet a published package

As of this writing, `isthmica`, `isthmica-orm`, `isthmicadb`, and
`@isthmica/core` are unpublished (verified against the npm registry directly
— all return HTTP 404). There is nothing to `npm install` from a registry
yet. To work with the project, clone it and work inside the workspace:

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
└── packages/
    ├── core/              # @isthmica/core — schema DSL + soft delete (implemented)
    │   ├── src/
    │   ├── test/
    │   ├── package.json
    │   ├── tsconfig.json
    │   └── tsup.config.ts
    └── db-ops/            # @isthmica/db-ops — optional: pg/prisma connect + CRUD (implemented)
        ├── src/
        ├── test/
        ├── package.json
        ├── tsconfig.json
        └── tsup.config.ts
```

`@isthmica/db-ops` depends on `@isthmica/core` (resolved via npm workspaces
to the local package, not the registry) but is entirely optional — nothing
in `@isthmica/core` depends on it, and using `@isthmica/core` on its own
works exactly as documented whether or not `db-ops` is installed. See
[`db-ops.md`](./db-ops.md).

Future packages (a CLI, dialect adapters beyond Postgres, etc.) will land as
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

You should see `@isthmica/core`'s test suite pass (6 tests, all asserting on
compiled SQL text — no live Postgres connection is required to run them; see
[`best-practices.md`](./best-practices.md#testing-without-a-live-database)
for why).
