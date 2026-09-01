# Roadmap

This reflects the phased plan as it stood after review corrected the
original, much larger scope (a from-scratch query engine, a migration
engine, CDC, multi-tenancy, partition lifecycle management, read-replica
routing, a second dialect, and a Studio-equivalent GUI, all as one
roadmap — multiple years of work for a well-funded team, not a sequenced
plan for an early project). The phases below front-load the uncontested
wedge and defer the crowded, hard-to-differentiate territory. Status
reflects what's actually implemented and tested today, not intent — and
every "first slice" below is deliberately, explicitly bounded (see each
linked page's own scope section), not a partial attempt at the full
original vision.

| Phase | Scope | Status |
|---|---|---|
| **0** | Schema DSL (`column()` builders, `table()`, `InferDatabase`) + soft delete + tenant-isolation type-safety primitive, built as a layer on Kysely. | 🟢 **All three implemented.** Schema DSL and soft delete are fully tested (see [`schema-dsl.md`](./schema-dsl.md), [`soft-delete.md`](./soft-delete.md)). Tenant isolation is a **first slice**: single-table `SELECT` only, no joins/subqueries/writes — see [`tenant-isolation.md`](./tenant-isolation.md) and [`known-risks.md`](./known-risks.md) for the boundary and the CI gap that limits how enforced the guarantee actually is. |
| **1** | Migrations: assisted expand/contract, linter, shadow-DB dry runs. | 🟡 **First slice implemented** (`@isthmica/migrations`): DDL generation, schema diffing, and diff application — see [`migrations.md`](./migrations.md). *Not* built: the linter, shadow-DB dry runs, or the assisted (human-confirmed) rename-disambiguation flow — renames still show up as drop+add, by design, with no confirmation UX since there's no CLI yet. |
| **2** | Index advisor, schema branching, type-safe seed/fixture system. | ⬜ Not started. |
| **3** | Partitioning. Read-replica routing stays a research spike, not a roadmap line — see [`known-risks.md`](./known-risks.md). | 🟡 **First slice implemented**: declarative `partitionBy` (range, monthly) + DDL generation — see [`partitioning.md`](./partitioning.md). Not execution-verified against live Postgres (no live Postgres exists in this project's test suite). No automatic partition lifecycle management — that needs a scheduler, which doesn't exist here. |
| **4** | Second dialect (MySQL), ecosystem tooling (Studio-equivalent GUI). | 🟡 **MySQL implemented** as a `@isthmica/db-ops` backend (`mysql.connect`), compile-only tested, not verified against a live MySQL server — see [`db-ops.md`](./db-ops.md#mysql-backend). Studio-equivalent GUI: not started. |

## `@isthmica/db-ops` and `@isthmica/migrations` — outside the phase numbering, on purpose

Neither package is one of the phased line items above, even though both
now implement pieces that phases reference:

- **`@isthmica/db-ops`** (connection helpers for `pg`/`prisma`/`mysql2`,
  plus a `createRepository` CRUD layer — see [`db-ops.md`](./db-ops.md)) is
  a convenience layer addressing the boilerplate of wiring
  `@isthmica/core` up in the first place — not part of the original wedge
  (soft delete / audit / tenant isolation / migrations / partitioning).
  ✅ Implemented; `pg` backend tested end-to-end; `prisma` and `mysql`
  backends implemented but not integration-tested against a live server
  (see [`known-risks.md`](./known-risks.md)).
- **`@isthmica/migrations`** exists because Phase 1 needed it and Phase 3
  (partitioning) extends it — it's the DDL/diff/apply engine both phases
  are built on, factored into its own package the same way `db-ops` was,
  not folded into `@isthmica/core`.

## What "done" means at each phase

A feature moves from ⬜/🟡 to 🟢 fully shipped when: it has an implementation
in the relevant package, a passing test suite (real-execution, not just
compile-only, if it does real database work), and a page in this `docs/`
folder describing both what it does and what it deliberately doesn't.
Missing any of those three is a signal something's incomplete — flag it
rather than treating the feature as done. Most items above are 🟡, not 🟢,
specifically because their scope is a deliberately-bounded first slice, not
the full phase description — read the linked page before assuming more is
covered than actually is.

## Known deviations from the original pitch, already corrected

These aren't things left to do later — they're corrections already made to
the plan itself, before Phase 0 code was written, and worth keeping visible
so they don't quietly regress back into the pitch:

- Runtime-weight-vs-Prisma is not treated as a differentiator (Prisma closed
  that gap itself — see [`background.md`](./background.md)).
- "Zero-engine execution... emits types, not runtime code" was replaced with
  the accurate "no external engine process" (see
  [`architecture.md`](./architecture.md)).
- Static-analysis claims were split three ways: tenant-isolation detection
  (achievable — now a tested first slice, see
  [`tenant-isolation.md`](./tenant-isolation.md)), N+1 detection (not
  achievable via the type system, downgraded to research), missing-index
  detection (needs live DB introspection, folded into the future index
  advisor).
- Migration expand/contract is planned as *assisted* (human confirms
  ambiguous renames), not fully automatic — every major migration tool
  (Rails, Django, Prisma Migrate) hits the same rename-vs-recreate ambiguity
  and routes it through a human for the same reason. `@isthmica/migrations`'
  `diffSchemas` implements the honest non-solution (rename = drop+add) but
  not yet the human-confirmation flow itself.
- Read-replica routing with automatic read-your-write consistency windows
  was downgraded from a Phase 3 line item to a dedicated research spike — a
  misjudged consistency window produces silent stale reads, which is a
  correctness risk, not a convenience trade-off.
