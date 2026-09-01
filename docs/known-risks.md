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

### Prisma backend (`@isthmica/db-ops`) not integration-tested

`prisma.connect()` in `@isthmica/db-ops` is implemented against
`prisma-extension-kysely`'s documented v4 API (verified against the
package's own README) and Prisma 7's driver-adapter requirement, but has
never been run against a live Prisma client — this repo has no generated
Prisma client to test against, and the packages involved
(`@prisma/client`, `@prisma/adapter-pg`, `prisma-extension-kysely`) are
optional peer dependencies not installed here. See
[`db-ops.md`](./db-ops.md#prisma-backend). Treat it as
implemented-per-documentation, not verified-working, until someone runs it
against a real Postgres + Prisma 7 setup.

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

## Discovered while building db-ops

Building `@isthmica/db-ops`'s repository layer (`get`/`insert`/`update`/`delete`
— see [`db-ops.md`](./db-ops.md)) exercised `@isthmica/core`'s schema DSL in
ways the DSL's own tests hadn't: writing real insert/update calls with
partial data, and running the soft-delete write path against a second SQL
dialect. Both surfaced real, previously-undiscovered issues in already-shipped
`@isthmica/core` code — fixed as part of this work, not left for later:

### `InferInsert`/`InferSelect` didn't mark DB-generated columns optional

The original `InferSelect`/`InferInsert` in `table.ts` mapped every column
straight through (`{ [K in keyof TColumns]: TColumns[K]["$insertType"] }`).
That looks right but isn't: a column typed `number | undefined` this way is
still a **required key** whose value may be `undefined` — not an
**optional key** you can omit. So `repo.insert({ label: "x" })` for a table
with an auto-generated `serial().primaryKey()` `id` failed to typecheck,
silently defeating the entire point of `.primaryKey()`/`.defaultNow()`
making a field optional on insert. Fixed by rebuilding `InferSelect`/
`InferInsert`/`InferUpdate` on top of Kysely's own `Selectable<T>`/
`Insertable<T>`/`Updateable<T>` utilities (which already do the
required/optional split correctly — that's exactly what they're for)
instead of a hand-rolled mapped type. See
[`schema-dsl.md`](./schema-dsl.md#inferdatabase).

### `softDeleteUpdate` used a JS `Date`, which isn't portable

`softDeleteUpdate` set `deleted_at` to a plain `new Date()`. That happens to
work against Postgres because the `pg` driver serializes JS `Date` objects,
but it isn't SQL — SQLite's driver (`better-sqlite3`, used in `db-ops`'s own
repository tests) throws on a bound `Date`, accepting only numbers, strings,
bigints, buffers, and `null`. Fixed by switching to
`sql`current_timestamp`` — standard SQL, valid on every dialect, and a
better default anyway (DB-server clock instead of app-server clock, so
skew between app instances can't produce inconsistent timestamps). See
[`soft-delete.md`](./soft-delete.md#api-summary).

### Column object key vs. declared column name — a real gap, not yet fixed

Distinct from the two fixes above: the string passed to
`text()`/`serial()`/`timestamp()` (e.g. `text("tenant_id")`) is not
currently wired to query generation at all — Kysely's typed queries
reference the **object key** you used in the `columns` record, not that
string. This is fully documented (with both workarounds) in
[`schema-dsl.md`](./schema-dsl.md#a-naming-detail-object-key-vs-declared-column-name)
rather than fixed here — making the `name` argument load-bearing would mean
giving `ColumnBuilder` a third, name-carrying type parameter so
`InferRawTable` could remap keys at the type level, which is a real (if
mechanical) type-signature change to `column.ts` and `table.ts` that
deserves its own pass rather than being folded into an unrelated db-ops
session. Tracked here as still-open, not silently left undocumented.

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
