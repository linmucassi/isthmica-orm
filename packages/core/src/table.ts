import type { ColumnType, Insertable, Selectable, Updateable } from "kysely";
import type { ColumnBuilder } from "./column.js";

export interface TableOptions {
  readonly softDelete?: boolean;
  readonly audit?: boolean;
}

type AnyColumns = Record<string, ColumnBuilder<any, any>>;

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

/** The raw per-table shape Kysely's `Database` interface expects. */
export type InferRawTable<TColumns extends AnyColumns> = {
  [K in keyof TColumns]: ColumnType<
    TColumns[K]["$selectType"],
    TColumns[K]["$insertType"],
    TColumns[K]["$insertType"]
  >;
};

// Built on Kysely's own `Selectable`/`Insertable`/`Updateable` rather than
// hand-rolled mapped types. A first version mapped every column straight
// through (`{ [K in keyof TColumns]: TColumns[K]["$insertType"] }`), which
// looked right but wasn't: a column typed `number | undefined` that way is
// still a *required* key whose value may be `undefined`, not an *optional*
// key — so `repo.insert({ label: "x" })` for a table with an
// auto-generated `id` failed to typecheck, defeating the entire point of
// `.primaryKey()`/`.defaultNow()` making insert optional. Kysely's own
// utilities already do the required/optional split correctly (that's
// exactly what they're for) — reuse them instead of re-solving it worse.
export type InferSelect<TColumns extends AnyColumns> = Selectable<InferRawTable<TColumns>>;
export type InferInsert<TColumns extends AnyColumns> = Insertable<InferRawTable<TColumns>>;
export type InferUpdate<TColumns extends AnyColumns> = Updateable<InferRawTable<TColumns>>;

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
