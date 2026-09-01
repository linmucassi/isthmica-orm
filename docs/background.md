# Background — why Isthmica exists

> *Isthmica* (adj., from **isthmus**): the narrow connective layer between two
> larger bodies. An ORM's entire job is to be that narrow, well-engineered
> connection between application code and the database — this project takes
> that literally.

## The landscape this project is responding to

The TypeScript ORM space has settled into a few camps, each with a real,
well-understood trade-off:

| ORM | Philosophy | Strength | Gap |
|---|---|---|---|
| **Drizzle** | SQL-first, code-first schema in TS | Tiny bundle, no external engine process, edge-native, strong migration DX | No built-in soft-delete, audit, multi-tenancy, or partitioning primitives |
| **Prisma** | Schema-first, generated client | Best-in-class DX, Prisma Studio, widest DB support. As of v6.16 (GA), Prisma ships a Rust-free TypeScript/WASM query engine — ~90% smaller bundle and up to 3.4x faster queries than the old Rust-engine architecture. | No first-class soft-delete/audit/tenant-scoping/partitioning primitives — same gap as everyone else |
| **Kysely** | Pure type-safe query builder | Zero codegen, maximum control, tiny footprint | No schema management, no migrations at all |
| **TypeORM / Sequelize** | Decorator / ActiveRecord | Mature, broad adoption | Migration tooling falls back to raw SQL for anything non-trivial; largely maintenance mode |

## Why this isn't "yet another query builder"

Early drafts of this project pitched runtime weight and a from-scratch query
engine as the differentiator. Two rounds of review corrected that:

1. **Runtime weight against Prisma is not a durable wedge.** Prisma closed
   that gap itself in 2025–2026 by removing its Rust dependency. Competing on
   bundle size or cold start would have meant chasing a target that was
   already moving.
2. **Building a competing query engine and migration engine from scratch was
   the wrong place to spend the technical budget.** That market is already
   crowded (Drizzle, Kysely, Prisma all solve typed SQL generation well) and
   hard to differentiate on DX alone.

The actual, uncontested gap — the thing every one of those tools makes teams
build by hand, every time — is **soft delete, audit/CDC, and tenant isolation
as typed, declarative, first-class primitives**, plus safer migrations and
partitioning lifecycle management. That's the wedge Isthmica is built around,
and it's why the architecture (see [`architecture.md`](./architecture.md))
is deliberately built *on top of* Kysely rather than replacing it.

## How this document set stays honest

This project's plan went through explicit review before any code was
written, and the corrections from that review are preserved rather than
smoothed over — see [`known-risks.md`](./known-risks.md) for the full list of
things that are still open bets, and [`roadmap.md`](./roadmap.md) for what's
been deliberately deferred and why. The short version: static analysis for
N+1 detection is not achievable through TypeScript's type system alone,
migration rename-detection is inherently ambiguous and needs human
confirmation, and the compile-time tenant-isolation guarantee — the
flagship safety feature — is the single hardest technical bet in the whole
project and has not yet been prototyped. None of that is hidden in favor of
a cleaner pitch.
