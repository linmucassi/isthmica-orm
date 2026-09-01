# Known risks

An honest register of what's still an open bet, kept separate from
[`roadmap.md`](./roadmap.md) because "not yet built" and "not yet validated
as *possible*" are different kinds of risk. Read this before committing a
timeline to anything marked still-open below.

## Still open

### Tenant-isolation type enforcement — the core unresolved bet

Not started. This is the single hardest technical bet in the project: making
a query that omits a required `tenantId` filter fail to *typecheck*, not
just fail at runtime. The planned mechanism is a type-state wrapper around
Kysely's builder classes (`SelectQueryBuilder`, `InsertQueryBuilder`,
`UpdateQueryBuilder`, `DeleteQueryBuilder`) — a phantom type tracking
"tenant scope applied," with `.execute()` gated on it.

This is a **different and harder mechanism** than the AST-rewriting the
soft-delete plugin uses (see [`architecture.md`](./architecture.md) for why
those two shouldn't be treated as validating each other). Concretely, it
requires re-implementing every chainable method across four separate
builder classes to thread the phantom type through composition — not
extending a documented extension point, but mirroring Kysely's internal
generic signatures. Before this goes any further:

- Prototype against a join, a subquery, and a dynamically-built conditional
  `.where()` chain (a common real-world pattern) — not just the simple
  single-table case.
- Decide up front whether a future Kysely major-version bump is a "patch our
  wrapper" event or a "pin and lag" event, since this wrapper couples to
  Kysely's internal builder types more deeply than the soft-delete plugin
  does.

### N+1 query detection

Not achievable via TypeScript's type system alone — it requires
control-flow/data-flow analysis across `await` points and loops, which means
a custom compiler plugin or a ts-morph/ESLint-style static-analysis pass,
not a "surfaces as a TypeScript compiler error" feature. Downgraded from the
original pitch to "researched, not promised." No work has started on this.

### Missing-index detection

Not a static-analysis problem — it needs live schema/index introspection
against a real database. Folded into the future index advisor (Phase 2),
which already assumes runtime telemetry rather than build-time analysis. No
work has started.

### Read-replica routing with automatic read-your-write consistency

A genuine correctness problem, not a convenience feature — a misjudged
consistency window produces silent stale reads that are painful to debug in
production. Needs a dedicated design spike before any timeline commitment.
Deliberately kept out of the phased roadmap (see `roadmap.md`) rather than
scheduled into Phase 3 by default.

### Migration rename disambiguation

Distinguishing a column rename from a drop-and-recreate is a structurally
ambiguous diff — every major migration tool (Rails, Django, Prisma Migrate)
routes this through a human confirmation rather than guessing, and Isthmica
is planned to do the same. The UX for that confirmation flow (how many
prompts is too many vs. how much silent-wrong-guessing is acceptable) hasn't
been designed. Migrations (Phase 1) haven't started at all.

### Package/domain naming

`isthmica`, `isthmica-orm`, `isthmicadb`, and `@isthmica/core` were
confirmed unpublished on the npm registry directly (all four return HTTP
404, checked via `registry.npmjs.org`, not just assumed from an earlier
draft). Domain availability (`isthmica.dev` / `.io`) has not been checked
from this environment. A formal trademark search (USPTO/EUIPO or
equivalent) has not been done and is recommended before any public launch.

## Discovered during implementation — new since the plan was written

### Soft delete doesn't scope writes against already-deleted rows

Found while building the plugin, not anticipated in planning: the AST
transformer only overrides `transformSelectQuery`. An `UPDATE` (or a raw
`.deleteFrom()`) targeting a row that's already soft-deleted is not blocked
— see [`soft-delete.md`](./soft-delete.md#what-it-does-not-do). This is a
real, current gap, not a hypothetical one. If your application logic depends
on "you can't update a soft-deleted row," you need to add that check
yourself for now.

## Mitigated, but not eliminated

### Coupling to Kysely's `@internal`-marked AST API

The soft-delete plugin (and any future audit/CDC plugin, since it'll use the
same mechanism) depends on Kysely internals explicitly marked `@internal` in
source, with no publicly documented plugin-authoring guide backing them.
This is now implemented and tested, which is meaningfully different from
"unvalidated" — but it's an **ongoing** risk, not a closed one: it needs
re-checking on every Kysely upgrade, not just once. See
[`best-practices.md`](./best-practices.md#dependency-hygiene) for the
specific check to run.

### Kysely SQL-injection advisories (CVE-relevant, pre-0.29.5)

Caught during this project's own dependency install, not assumed from a
changelog: Kysely versions up to and including 0.28.16 have real advisories
(JSON-path traversal injection, insufficient MySQL backslash escaping),
fixed in 0.29.5. `@isthmica/core` now pins its dev dependency at `^0.29.5`
and its peer dependency floor at `^0.29.0`. Closed for this codebase; still
worth `npm audit`-checking any project consuming it, since a peer dependency
range doesn't stop a consumer from installing something older.
