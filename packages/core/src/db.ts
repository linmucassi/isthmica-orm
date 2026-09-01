import { sql, type Kysely, type UpdateQueryBuilder, type UpdateResult } from "kysely";
import { createSoftDeletePlugin } from "./plugins/soft-delete.js";
import { softDeleteTableNames, type TableDefinition } from "./table.js";

/**
 * Installs the soft-delete plugin (auto `deleted_at IS NULL` scoping on
 * SELECTs) for every table in `tables` that declares `softDelete: true`.
 * Returns the same Kysely instance unchanged if none do.
 */
export function withSoftDelete<DB>(
  db: Kysely<DB>,
  tables: Record<string, TableDefinition<any, any>>,
): Kysely<DB> {
  const names = softDeleteTableNames(tables);
  if (names.length === 0) {
    return db;
  }
  return db.withPlugin(createSoftDeletePlugin({ tables: names }));
}

/**
 * Escape hatch matching `.withDeleted()` from the plan doc: bypasses every
 * Isthmica plugin (not just soft-delete) for queries built from the
 * returned instance. Backed by Kysely's own `withoutPlugins()`.
 */
export function withDeleted<DB>(db: Kysely<DB>): Kysely<DB> {
  return db.withoutPlugins();
}

/**
 * The write side of soft delete. Kysely's plugin API can't rewrite a
 * `.deleteFrom()` into an UPDATE (see soft-delete.ts docblock), so this is
 * a distinct, explicit entry point rather than AST interception: it issues
 * a real `UPDATE <table> SET <deletedAtColumn> = current_timestamp ...`.
 * Runs against `withoutPlugins()` so the soft-delete filter doesn't stop it
 * from updating a row that isn't deleted yet.
 *
 * Uses `sql`current_timestamp`` (a DB-server-clock SQL expression) rather
 * than a JS-side `new Date()` — not just for correctness against clock skew
 * between app instances, but because a raw `Date` object isn't portable:
 * `pg` happens to serialize it, but SQLite's driver (via better-sqlite3,
 * used in this package's own tests — see docs/best-practices.md) throws on
 * a bound `Date`, accepting only numbers/strings/bigints/buffers/null.
 * `current_timestamp` is standard SQL, valid on every dialect Isthmica
 * targets now or later.
 */
export function softDeleteUpdate<DB, TB extends keyof DB & string>(
  db: Kysely<DB>,
  table: TB,
  deletedAtColumn: string = "deleted_at",
): UpdateQueryBuilder<DB, TB, TB, UpdateResult> {
  // `set()` has three overloads keyed on its argument shape, which don't
  // unify for a dynamically-named column — narrowing to a single callable
  // signature here is the pragmatic MVP escape hatch, not a type hole in
  // the public API (the return type above is still fully typed).
  const updateBuilder = withDeleted(db).updateTable(table) as unknown as {
    set(values: Record<string, unknown>): UpdateQueryBuilder<DB, TB, TB, UpdateResult>;
  };
  return updateBuilder.set({ [deletedAtColumn]: sql`current_timestamp` });
}
