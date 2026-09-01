import type {
  ComparisonOperatorExpression,
  Kysely,
  OperandValueExpressionOrList,
  ReferenceExpression,
  Selectable,
  SelectQueryBuilder,
} from "kysely";

/**
 * A type-state wrapper enforcing, at compile time, that a query against a
 * tenant-scoped table cannot be executed without an explicit `.forTenant()`
 * call. This is Isthmica's flagship compile-time safety feature — and its
 * hardest, still-unresolved-beyond-this-slice bet. Read
 * docs/tenant-isolation.md and docs/known-risks.md before relying on it
 * beyond the scope below.
 *
 * **Scope: single-table SELECT only.** No joins, no subqueries, no
 * INSERT/UPDATE/DELETE. `.forTenant(tenantId)` is the *only* way to
 * satisfy the guarantee — there is no generic `.where()`-based detection
 * (reliably inferring "did this arbitrary condition scope the tenant
 * column" from a single `.where()` call isn't decidable in general, so
 * this doesn't attempt it).
 *
 * **The guarantee is only enforced if `npm run typecheck` actually runs.**
 * This repo has no CI configured — see docs/known-risks.md. A
 * `// @ts-expect-error` test proves the compile error exists, but only
 * `tsc` catches a regression; `vitest` transpiles via esbuild and never
 * type-checks.
 */
export class TenantScopedSelectQueryBuilder<
  DB,
  TB extends keyof DB & string,
  O,
  TTenantColumn extends keyof DB[TB] & string,
  TScoped extends boolean = false,
> {
  /**
   * Phantom — never assigned at runtime. Makes `TScoped` structurally
   * load-bearing, so a `false`-scoped and a `true`-scoped instantiation
   * aren't silently mutually assignable (which would defeat the whole
   * point: without this field, both instantiations have identical actual
   * shape, since `TScoped` otherwise never appears in any real member).
   */
  declare readonly _tenantScope: TScoped;

  private constructor(
    private readonly qb: SelectQueryBuilder<DB, TB, O>,
    private readonly tenantColumn: TTenantColumn,
  ) {}

  /** @internal — use `tenantScoped()` instead. */
  static create<DB, TB extends keyof DB & string, O, TTenantColumn extends keyof DB[TB] & string>(
    qb: SelectQueryBuilder<DB, TB, O>,
    tenantColumn: TTenantColumn,
  ): TenantScopedSelectQueryBuilder<DB, TB, O, TTenantColumn, false> {
    return new TenantScopedSelectQueryBuilder<DB, TB, O, TTenantColumn, false>(qb, tenantColumn);
  }

  where<RE extends ReferenceExpression<DB, TB>, VE extends OperandValueExpressionOrList<DB, TB, RE>>(
    lhs: RE,
    op: ComparisonOperatorExpression,
    rhs: VE,
  ): TenantScopedSelectQueryBuilder<DB, TB, O, TTenantColumn, TScoped> {
    return new TenantScopedSelectQueryBuilder<DB, TB, O, TTenantColumn, TScoped>(
      this.qb.where(lhs, op, rhs),
      this.tenantColumn,
    );
  }

  limit(count: number): TenantScopedSelectQueryBuilder<DB, TB, O, TTenantColumn, TScoped> {
    return new TenantScopedSelectQueryBuilder<DB, TB, O, TTenantColumn, TScoped>(
      this.qb.limit(count),
      this.tenantColumn,
    );
  }

  /** The only way to flip the phantom scope to `true`. */
  forTenant(
    tenantId: OperandValueExpressionOrList<DB, TB, TTenantColumn>,
  ): TenantScopedSelectQueryBuilder<DB, TB, O, TTenantColumn, true> {
    return new TenantScopedSelectQueryBuilder<DB, TB, O, TTenantColumn, true>(
      this.qb.where(this.tenantColumn, "=", tenantId as never),
      this.tenantColumn,
    );
  }

  // Terminal methods, gated via a polymorphic `this` parameter requiring
  // `TScoped extends true`. Calling one of these before `.forTenant()` is
  // a genuine TS compile error — not just an unusable `never` return.
  // Return types are inferred directly from the wrapped
  // `SelectQueryBuilder`'s own methods rather than re-declared here, so
  // they stay exactly correct across Kysely versions without duplicating
  // its `Simplify`/`SimplifyResult` wrapping logic.

  compile(this: TenantScopedSelectQueryBuilder<DB, TB, O, TTenantColumn, true>) {
    return this.qb.compile();
  }

  execute(this: TenantScopedSelectQueryBuilder<DB, TB, O, TTenantColumn, true>) {
    return this.qb.execute();
  }

  executeTakeFirst(this: TenantScopedSelectQueryBuilder<DB, TB, O, TTenantColumn, true>) {
    return this.qb.executeTakeFirst();
  }
}

/**
 * Starts a tenant-scoped query against `table`, requiring `.forTenant(id)`
 * before it can be compiled or executed. `tenantColumn` is passed
 * explicitly at the call site — Isthmica doesn't track "which column is
 * the tenant column" as table-level metadata (see docs/tenant-isolation.md
 * for why: nothing in this first slice actually reads such metadata, so
 * adding it now would just be another unused field, the same mistake
 * `TableOptions.audit` made early on).
 */
export function tenantScoped<DB, TB extends keyof DB & string, TCol extends keyof DB[TB] & string>(
  db: Kysely<DB>,
  table: TB,
  tenantColumn: TCol,
): TenantScopedSelectQueryBuilder<DB, TB, Selectable<DB[TB]>, TCol, false> {
  // `db.selectFrom(table)` doesn't unify cleanly when `table: TB` is a
  // generic type parameter rather than a literal — Kysely's `selectFrom`
  // overload set is resolved against the *widened* `keyof DB & string`
  // constraint, not the specific `TB`, and produces a type that doesn't
  // structurally match `SelectQueryBuilder<DB, TB, ...>`. Same class of
  // friction already worked around with an `as`/`as unknown` escape hatch
  // in db.ts/repository.ts for the same underlying reason — applying the
  // same pattern here rather than fighting the overload resolution.
  const anyDb = db as unknown as {
    selectFrom(table: string): { selectAll(): SelectQueryBuilder<DB, TB, Selectable<DB[TB]>> };
  };
  return TenantScopedSelectQueryBuilder.create(anyDb.selectFrom(table).selectAll(), tenantColumn);
}
