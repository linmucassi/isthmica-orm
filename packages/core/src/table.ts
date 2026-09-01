import type { ColumnType, Insertable, Selectable, Updateable } from "kysely";
import type { ColumnBuilder } from "./column.js";

export interface TableOptions {
  readonly softDelete?: boolean;
  readonly audit?: boolean;
  /**
   * Declarative range partitioning, consumed by `@isthmica/migrations`'
   * `generateCreateTable` (this package has no DDL generation of its own —
   * see docs/partitioning.md). `column` is the declared column name (same
   * convention as everywhere else — see the naming note above), not the
   * object key. Postgres only; `list`/`hash` variants and automatic
   * partition lifecycle management (creating/dropping partitions on a
   * schedule) are out of scope — no scheduler exists in this project.
   */
  readonly partitionBy?: {
    readonly type: "range";
    readonly column: string;
    readonly interval: "month";
  };
}

type AnyColumns = Record<string, ColumnBuilder<any, any, any>>;

export interface TableDefinition<
  TName extends string = string,
  TColumns extends AnyColumns = AnyColumns,
> {
  readonly name: TName;
  readonly columns: TColumns;
  readonly options: TableOptions;
  /** Phantom — never assigned at runtime. Read only via `typeof t.$inferSelect`. */
  readonly $inferSelect: InferSelect<TColumns>;
  readonly $inferInsert: InferInsert<TColumns>;
}

/**
 * The raw per-table shape Kysely's `Database` interface expects — keyed by
 * each column's *declared* name (the string passed to `text()`/`serial()`/
 * `timestamp()`), not by its object key in the `columns` record. This is
 * what makes `tenantId: text("tenant_id")` actually reference `tenant_id`
 * in compiled SQL. `InferSelect`/`InferInsert`/`InferUpdate` below stay
 * keyed by object key — that split (DB-facing raw name vs. JS-facing
 * ergonomic key) is intentional, see docs/schema-dsl.md.
 */
export type InferRawTable<TColumns extends AnyColumns> = {
  [K in keyof TColumns as TColumns[K]["name"]]: ColumnType<
    TColumns[K]["$selectType"],
    TColumns[K]["$insertType"],
    TColumns[K]["$insertType"]
  >;
};

/**
 * The JS-facing per-table shape, keyed by object key (not declared name) —
 * deliberately a *different* mapped type from `InferRawTable`, not derived
 * from it. `InferSelect`/`InferInsert`/`InferUpdate` below need to stay
 * keyed by object key even after `InferRawTable` switched to keying by
 * declared name (see above) — deriving them from `InferRawTable` would
 * silently re-key them too, which defeats the entire DB-facing/JS-facing
 * split this file documents. (This is exactly the bug that shipped in a
 * first draft of the declared-name fix, caught immediately by
 * `@isthmica/db-ops`'s repository tests failing to typecheck.)
 */
type InferObjectKeyedRawTable<TColumns extends AnyColumns> = {
  [K in keyof TColumns]: ColumnType<
    TColumns[K]["$selectType"],
    TColumns[K]["$insertType"],
    TColumns[K]["$insertType"]
  >;
};

// Built on Kysely's own `Selectable`/`Insertable`/`Updateable` rather than
// hand-rolled mapped types. An earlier version mapped every column straight
// through (`{ [K in keyof TColumns]: TColumns[K]["$insertType"] }`), which
// looked right but wasn't: a column typed `number | undefined` that way is
// still a *required* key whose value may be `undefined`, not an *optional*
// key — so `repo.insert({ label: "x" })` for a table with an
// auto-generated `id` failed to typecheck, defeating the entire point of
// `.primaryKey()`/`.defaultNow()` making insert optional. Kysely's own
// utilities already do the required/optional split correctly (that's
// exactly what they're for) — reuse them instead of re-solving it worse.
export type InferSelect<TColumns extends AnyColumns> = Selectable<InferObjectKeyedRawTable<TColumns>>;
export type InferInsert<TColumns extends AnyColumns> = Insertable<InferObjectKeyedRawTable<TColumns>>;
export type InferUpdate<TColumns extends AnyColumns> = Updateable<InferObjectKeyedRawTable<TColumns>>;

export function table<TName extends string, TColumns extends AnyColumns>(
  name: TName,
  columns: TColumns,
  options: TableOptions = {},
): TableDefinition<TName, TColumns> {
  return { name, columns, options } as TableDefinition<TName, TColumns>;
}

/** Builds the `Database` type Kysely needs, keyed by each table's declared name. */
export type InferDatabase<TTables extends Record<string, TableDefinition<any, any>>> = {
  [K in keyof TTables as TTables[K]["name"]]: InferRawTable<TTables[K]["columns"]>;
};

export function softDeleteTableNames(
  tables: Record<string, TableDefinition<any, any>>,
): string[] {
  return Object.values(tables)
    .filter((t) => t.options.softDelete)
    .map((t) => t.name);
}

export function auditTableNames(tables: Record<string, TableDefinition<any, any>>): string[] {
  return Object.values(tables)
    .filter((t) => t.options.audit)
    .map((t) => t.name);
}
