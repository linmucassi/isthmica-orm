import type { ColumnType } from "kysely";
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

export type InferSelect<TColumns extends AnyColumns> = {
  [K in keyof TColumns]: TColumns[K]["$selectType"];
};

export type InferInsert<TColumns extends AnyColumns> = {
  [K in keyof TColumns]: TColumns[K]["$insertType"];
};

/** The raw per-table shape Kysely's `Database` interface expects. */
export type InferRawTable<TColumns extends AnyColumns> = {
  [K in keyof TColumns]: ColumnType<
    TColumns[K]["$selectType"],
    TColumns[K]["$insertType"],
    TColumns[K]["$insertType"]
  >;
};

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
