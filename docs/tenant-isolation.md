# Tenant isolation

Status: 🟡 **first slice implemented** (`packages/core/src/tenant.ts`), tested,
and its core guarantee independently verified — but deliberately bounded.
This is the project's flagship compile-time safety feature and its hardest
unresolved bet; read this whole page, not just the API, before relying on
it beyond the scope below.

## What it does

`tenantScoped()` wraps a single-table `SELECT` in a type-state builder that
tracks, at the type level, whether `.forTenant(id)` has been called.
`.execute()`, `.executeTakeFirst()`, and `.compile()` are only callable once
it has — calling any of them first is a genuine TypeScript compile error,
not a runtime check.

```ts
import { tenantScoped } from "@isthmica/core";

// db: Kysely<DB> — orders has a tenant_id column
const openOrders = await tenantScoped(db, "orders", "tenant_id")
  .where("status", "=", "open")
  .forTenant(currentTenantId)
  .execute();
```

```ts
// This does not compile:
const scoped = tenantScoped(db, "orders", "tenant_id").where("status", "=", "open");
scoped.execute();
// Type error: The 'this' context of type '...false' is not assignable
// to method's 'this' of type '...true'.
```

`tenantScoped(db, table, tenantColumn)` — `tenantColumn` is the column's
**declared name** (the string passed to `text()`/`serial()`/etc., not the
object key — see [`schema-dsl.md`](./schema-dsl.md#a-naming-detail-object-key-vs-declared-column-name)),
passed explicitly at the call site. There's no table-level "this is the
tenant column" declaration — see [why](#why-no-table-level-declaration)
below.

## Scope — read this before reaching for it on anything else

**Single-table `SELECT` only.** No joins, no subqueries, no
INSERT/UPDATE/DELETE. `.forTenant(id)` is the *only* way to satisfy the
guarantee — there's no generic `.where()`-based detection (reliably
inferring "did this arbitrary condition scope the tenant column" from a
single `.where()` call isn't decidable in general, so this doesn't attempt
it).

Extending this to joins, subqueries, or the write path is a real, separate
design effort — the current mechanism doesn't generalize to them
automatically, and none of it has been attempted.

## The mechanism, briefly

`TenantScopedSelectQueryBuilder<DB, TB, O, TTenantColumn, TScoped>` wraps a
real `SelectQueryBuilder<DB, TB, O>` and carries a phantom boolean type
parameter, `TScoped`, that starts `false`. `.forTenant()` is the only method
that returns an instance with `TScoped` flipped to `true`. The terminal
methods (`compile`/`execute`/`executeTakeFirst`) each declare a polymorphic
`this` parameter requiring `TScoped extends true` — TypeScript's structural
assignability genuinely rejects calling them on a `false`-scoped instance,
which was confirmed directly (not assumed): temporarily removing the
`@ts-expect-error` suppression in the test file and re-running `tsc`
produces a real `TS2684` error, not a silently-passing check.

A `declare readonly _tenantScope: TScoped` phantom field makes `TScoped`
structurally load-bearing — without it, a `false`-scoped and a
`true`-scoped instance would be structurally identical (since `TScoped`
otherwise never appears in any real member) and mutually assignable, which
would defeat the whole guarantee.

## Why no table-level declaration

An earlier design considered adding a `TableOptions.tenantScoped: { column: string }`
runtime option, matching `softDelete`/`audit`'s pattern. It was dropped: the
actual enforcement mechanism never reads that option — it comes entirely
from `tenantScoped()`'s explicit call-site arguments. Adding it would have
been unused metadata that could silently drift out of sync with the real
column passed at each call site — the same mistake `TableOptions.audit`
made early on, before it had a real consumer. If a table-level declaration
becomes genuinely load-bearing later (e.g. to auto-derive the tenant column
so callers can't typo it), it should be added then, with a real consumer,
not preemptively.

## The guarantee only holds if `tsc` actually runs

This is the single most important caveat on this page: **this repo has no
CI configured.** A `// @ts-expect-error` test proves the mechanism works,
but it only fails a build if `npm run typecheck` is actually run — `vitest`
transpiles via esbuild and never type-checks, so a regression here would
pass the test suite silently. Until CI exists (see
[`known-risks.md`](./known-risks.md)), running `npm run typecheck`
before merging is a manual discipline, not an enforced one.

## Testing

`packages/core/test/tenant.test.ts` covers two things, deliberately by
different mechanisms:

- **Query shape**, via the established compile-only pattern (`.compile().sql`
  assertions) — confirms `.forTenant()` actually adds the right filter,
  regardless of where in the chain it's called.
- **The compile-time guarantee itself**, via `// @ts-expect-error` lines —
  this only means something when `npm run typecheck` runs (see above), and
  was verified to genuinely catch a real error, not just accepted as inert,
  before being trusted.
