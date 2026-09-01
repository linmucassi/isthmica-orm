# Architecture

## Built on Kysely, not competing with it

Isthmica does not implement its own query builder or SQL compiler.
`@isthmica/core` takes a real `Kysely<DB>` instance and layers declarative
primitives on top of it — the schema DSL feeds Kysely's own `Database`
typing (via `InferDatabase`, see [`schema-dsl.md`](./schema-dsl.md)), and
soft delete is implemented as a standard Kysely plugin (see
[`soft-delete.md`](./soft-delete.md)).

This was a deliberate scope decision made during planning, not an accident
of what got built first. The query-builder and migration-engine space is
already crowded (Drizzle, Kysely, Prisma all solve typed SQL generation
well) and hard to differentiate on DX alone. Building on Kysely eliminates
the query-execution and query-typing layer as something Isthmica has to
build and maintain — but it's worth being precise about what that does and
doesn't save: Kysely has no schema DSL, no migration story, and no
declarative `table()`-style primitives, so the schema DSL, the migrations
engine, and every primitive in this project's actual value proposition
(soft delete, audit, tenant isolation, partitioning) are still fully
Isthmica's to build regardless.

## "No external engine process," not "no runtime"

An earlier draft of this project's plan described the intended architecture
as "zero-engine execution" that "emits types, not runtime code." That
framing doesn't hold up: a query builder that actually executes SQL against
a connection necessarily has runtime code — building queries, serializing
them, mapping results back. No working ORM can avoid having a runtime.

The real, defensible claim — and the one this codebase actually delivers on
— is architectural, not existential: **no external engine process**. There's
no separate Rust/WASM binary or subprocess to shell out to, the way Prisma's
original architecture worked before it moved to a Rust-free engine itself.
Everything runs in-process, in the same model Kysely and Drizzle already use.
"Zero runtime" was never achievable; "no process boundary between your code
and query compilation" is, and is what's implemented.

## Two different mechanisms live under "plugin," with two different risk
profiles

This distinction matters enough to repeat outside of `soft-delete.md`:

- **AST rewriting via `OperationNodeTransformer`** (what soft delete uses
  today, and what audit/CDC will use when built) touches Kysely internals
  marked `@internal` in source, with no publicly documented plugin-authoring
  guide. It works, and it's the same mechanism Kysely's own bundled plugins
  use — but it's not a contract Kysely has committed to for third parties.
- **A type-state builder wrapper** (what compile-time tenant-isolation
  enforcement will require — see [`known-risks.md`](./known-risks.md)) is a
  different, harder mechanism: wrapping Kysely's chainable builder classes
  (`SelectQueryBuilder`, `InsertQueryBuilder`, `UpdateQueryBuilder`,
  `DeleteQueryBuilder`) to thread a phantom type through composition, gating
  `.execute()` on it. This has not been prototyped. Don't assume validating
  the AST-rewriting mechanism (which soft delete now does, in production
  test form) says anything about whether the type-state mechanism will work
  — they share the word "plugin" in casual conversation and nothing else.

## Testing without a live database

Because there's no external engine process, `.compile()` on any Kysely query
builder produces SQL text without executing anything — no connection is
opened. `@isthmica/core`'s own test suite relies on this: it constructs a
`Kysely` instance with a real `PostgresDialect` and a `pg.Pool` that's never
connected to an actual database, and asserts against the compiled SQL
string. See [`best-practices.md`](./best-practices.md#testing-without-a-live-database)
for the pattern.

## Dialect support

Postgres only, today. `PostgresDialect` is what the codebase and its tests
are built against. MySQL and SQLite are planned (Phase 4, see
[`roadmap.md`](./roadmap.md)) but nothing in `@isthmica/core` has been
validated against either.
