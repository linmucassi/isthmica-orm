# Roadmap

This reflects the phased plan as it stood after review corrected the
original, much larger scope (a from-scratch query engine, a migration
engine, CDC, multi-tenancy, partition lifecycle management, read-replica
routing, a second dialect, and a Studio-equivalent GUI, all as one
roadmap — multiple years of work for a well-funded team, not a sequenced
plan for an early project). The phases below front-load the uncontested
wedge and defer the crowded, hard-to-differentiate territory. Status
reflects what's actually in `packages/core/src` today, not intent.

| Phase | Scope | Status |
|---|---|---|
| **0** | Schema DSL (`column()` builders, `table()`, `InferDatabase`) + soft delete, built as a layer on Kysely. Tenant-isolation type-safety primitive was also scoped for this phase. | 🟡 **Partial.** Schema DSL and soft delete are implemented and tested (see [`schema-dsl.md`](./schema-dsl.md), [`soft-delete.md`](./soft-delete.md)). Tenant isolation has **not** been started — it's the hardest technical bet in the project and needs its own prototype first (see [`known-risks.md`](./known-risks.md)). |
| **1** | Migrations: assisted expand/contract, linter, shadow-DB dry runs. | ⬜ Not started. |
| **2** | Index advisor, schema branching, type-safe seed/fixture system. | ⬜ Not started. |
| **3** | Partitioning. Read-replica routing stays a research spike, not a roadmap line — see [`known-risks.md`](./known-risks.md). | ⬜ Not started. |
| **4** | Second dialect (MySQL), ecosystem tooling (Studio-equivalent GUI). | ⬜ Not started. |

## What "done" means at each phase

A feature moves from ⬜/🟡 to fully shipped when: it has an implementation
in `packages/core/src` (or a new package under `packages/`), a passing test
suite, and a page in this `docs/` folder describing both what it does and
what it deliberately doesn't. Half of those three existing without the third
is a signal something's incomplete — flag it rather than treating the
feature as done.

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
  (achievable, still unbuilt), N+1 detection (not achievable via the type
  system, downgraded to research), missing-index detection (needs live DB
  introspection, folded into the future index advisor).
- Migration expand/contract is planned as *assisted* (human confirms
  ambiguous renames), not fully automatic — every major migration tool
  (Rails, Django, Prisma Migrate) hits the same rename-vs-recreate ambiguity
  and routes it through a human for the same reason.
- Read-replica routing with automatic read-your-write consistency windows
  was downgraded from a Phase 3 line item to a dedicated research spike — a
  misjudged consistency window produces silent stale reads, which is a
  correctness risk, not a convenience trade-off.
