import type {
  ColumnDataType as KyselyColumnDataType,
  ColumnDefinitionBuilder,
  CreateTableBuilder,
  Kysely,
} from "kysely";
import { sql } from "kysely";
import type { ColumnBuilder, ColumnDataType, TableDefinition } from "@isthmica/core";

export type DdlDialect = "postgres" | "sqlite";

/**
 * "sqlite" exists solely so DDL generation is real-execution-testable in
 * this project — there's no live Postgres anywhere in the test suite.
 * "postgres" is the real, documented default; @isthmica/core is
 * Postgres-only today (see docs/architecture.md).
 */
export interface GenerateCreateTableOptions {
  readonly dialect?: DdlDialect;
}

// `KyselyColumnDataType` is Kysely's own closed union of recognized SQL
// type keywords — required by addColumn()'s DataTypeExpression parameter.
// Named apart from @isthmica/core's own (unrelated) ColumnDataType export.
const POSTGRES_TYPES: Record<ColumnDataType, KyselyColumnDataType> = {
  text: "text",
  serial: "serial",
  timestamp: "timestamp",
};

// SQLite has no SERIAL or native TIMESTAMP type — "integer" + autoIncrement()
// covers serial's auto-increment behavior, and "text" is the conventional
// SQLite storage class for ISO-8601 timestamps.
const SQLITE_TYPES: Record<ColumnDataType, KyselyColumnDataType> = {
  text: "text",
  serial: "integer",
  timestamp: "text",
};

export function resolveSqlType(dataType: ColumnDataType, dialect: DdlDialect): KyselyColumnDataType {
  return dialect === "sqlite" ? SQLITE_TYPES[dataType] : POSTGRES_TYPES[dataType];
}

/**
 * `ColumnBuilder.hasDefault` alone can't drive DDL correctly — it's `true`
 * for both `.primaryKey()` (DB-generated, no explicit default value to
 * emit) and `.defaultNow()` (a real `current_timestamp` default).
 * Disambiguate by `dataType`/`isPrimaryKey` instead. A future generic
 * `.default(value)` column modifier would need `hasDefault` to become a
 * richer field — this heuristic is scoped to today's exact column.ts
 * factory set, not a general solution.
 */
export function applyColumnModifiers(
  col: ColumnDefinitionBuilder,
  column: ColumnBuilder<any, any, any>,
  dialect: DdlDialect,
): ColumnDefinitionBuilder {
  let built = col;
  if (column.isNotNull) {
    built = built.notNull();
  }
  if (column.isPrimaryKey) {
    built = built.primaryKey();
    if (column.dataType === "serial" && dialect === "sqlite") {
      built = built.autoIncrement();
    }
  }
  if (column.dataType === "timestamp" && column.hasDefault && !column.isPrimaryKey) {
    built = built.defaultTo(sql`current_timestamp`);
  }
  return built;
}

/**
 * Generates a `CREATE TABLE` for a `table()` definition, driven by
 * Kysely's own schema builder (not hand-formatted SQL) for correctness and
 * dialect-aware escaping. Call `.execute()` on the result to actually run
 * it, or `.compile()` to inspect the SQL first.
 */
export function generateCreateTable<DB>(
  db: Kysely<DB>,
  table: TableDefinition<any, any>,
  options: GenerateCreateTableOptions = {},
): CreateTableBuilder<any, any> {
  const dialect = options.dialect ?? "postgres";
  let builder: CreateTableBuilder<any, any> = db.schema.createTable(table.name);

  for (const column of Object.values(table.columns) as ColumnBuilder<any, any, any>[]) {
    const sqlType = resolveSqlType(column.dataType, dialect);
    builder = builder.addColumn(column.name, sqlType, (col) =>
      applyColumnModifiers(col, column, dialect),
    );
  }

  if (table.options.partitionBy) {
    if (dialect === "sqlite") {
      throw new Error(
        `table "${table.name}": partitionBy is Postgres-only, not supported with dialect: "sqlite"`,
      );
    }
    // No dedicated Kysely builder method for PARTITION BY exists (scanned
    // CreateTableBuilder's full method list) — modifyEnd() is the
    // documented, public hook for exactly this ("adds any additional SQL
    // to the end of the query", per its own JSDoc example), not a
    // workaround for something the builder should have.
    builder = builder.modifyEnd(
      sql`partition by range (${sql.ref(table.options.partitionBy.column)})`,
    );
  }

  return builder;
}
