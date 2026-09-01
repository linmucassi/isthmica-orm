import type { ColumnBuilder, TableDefinition } from "@isthmica/core";
import type { Kysely } from "kysely";
import { applyColumnModifiers, generateCreateTable, resolveSqlType, type DdlDialect } from "./ddl.js";
import { diffSchemas } from "./diff.js";

export interface ApplyMigrationOptions {
  readonly dialect?: DdlDialect;
}

/**
 * Applies the diff between two schema snapshots: creates added tables
 * (via `generateCreateTable`), adds/drops columns on changed tables (via
 * Kysely's `AlterTableBuilder`), and drops removed tables — all inside one
 * transaction. Column identity throughout is by declared name, matching
 * `diffSchemas`/`generateCreateTable`.
 *
 * The chained `AlterTableBuilder`/`AlterTableColumnAlteringBuilder` calls
 * below are typed as `any` internally — Kysely's builder narrows to a
 * different (though structurally compatible) type after the first
 * `.addColumn()`/`.dropColumn()` call, which doesn't unify cleanly with a
 * `let`-declared variable across a loop. Same pragmatic escape hatch this
 * codebase already uses in `db.ts`/`repository.ts` for dynamic Kysely
 * builder chains.
 */
export async function applyMigration<DB>(
  db: Kysely<DB>,
  before: readonly TableDefinition<any, any>[],
  after: readonly TableDefinition<any, any>[],
  options: ApplyMigrationOptions = {},
): Promise<void> {
  const dialect = options.dialect ?? "postgres";
  const diff = diffSchemas(before, after);
  const afterByName = new Map(after.map((t) => [t.name, t]));

  await db.transaction().execute(async (trx) => {
    for (const tableName of diff.addedTables) {
      const table = afterByName.get(tableName);
      if (!table) continue;
      await generateCreateTable(trx, table, { dialect }).execute();
    }

    for (const change of diff.changedTables) {
      const table = afterByName.get(change.table);
      if (!table) continue;

      const columnsByName = new Map(
        (Object.values(table.columns) as ColumnBuilder<any, any, any>[]).map((c) => [c.name, c]),
      );

      let builder: any = trx.schema.alterTable(change.table);
      for (const columnName of change.addedColumns) {
        const column = columnsByName.get(columnName);
        if (!column) continue;
        const sqlType = resolveSqlType(column.dataType, dialect);
        builder = builder.addColumn(column.name, sqlType, (col: any) =>
          applyColumnModifiers(col, column, dialect),
        );
      }
      for (const columnName of change.removedColumns) {
        builder = builder.dropColumn(columnName);
      }
      await builder.execute();
    }

    for (const tableName of diff.removedTables) {
      await trx.schema.dropTable(tableName).execute();
    }
  });
}
