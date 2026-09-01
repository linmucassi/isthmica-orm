import type { ColumnBuilder, TableDefinition } from "@isthmica/core";

export interface ChangedTableDiff {
  readonly table: string;
  readonly addedColumns: readonly string[];
  readonly removedColumns: readonly string[];
}

export interface SchemaDiff {
  readonly addedTables: readonly string[];
  readonly removedTables: readonly string[];
  readonly changedTables: readonly ChangedTableDiff[];
}

/**
 * Pure data-structure diff between two schema snapshots — no DB connection
 * needed. Tables are matched by declared name (`table.name`); columns
 * within a matched table are matched by declared name too (not object
 * key), for consistency with `generateCreateTable`.
 *
 * A renamed column (same object key with a new declared name, or vice
 * versa) shows up as a plain drop+add pair here — this is a deliberate,
 * honest non-solution, not a silent mishandling: distinguishing a rename
 * from a drop+recreate is a structurally ambiguous diff that every major
 * migration tool (Rails, Django, Prisma Migrate) routes through human
 * confirmation rather than guessing. See docs/known-risks.md.
 */
export function diffSchemas(
  before: readonly TableDefinition<any, any>[],
  after: readonly TableDefinition<any, any>[],
): SchemaDiff {
  const beforeByName = new Map(before.map((t) => [t.name, t]));
  const afterByName = new Map(after.map((t) => [t.name, t]));

  const addedTables = [...afterByName.keys()].filter((name) => !beforeByName.has(name));
  const removedTables = [...beforeByName.keys()].filter((name) => !afterByName.has(name));

  const changedTables: ChangedTableDiff[] = [];
  for (const [name, beforeTable] of beforeByName) {
    const afterTable = afterByName.get(name);
    if (!afterTable) {
      continue;
    }

    const beforeColumnNames = new Set(declaredColumnNames(beforeTable));
    const afterColumnNames = new Set(declaredColumnNames(afterTable));

    const addedColumns = [...afterColumnNames].filter((n) => !beforeColumnNames.has(n));
    const removedColumns = [...beforeColumnNames].filter((n) => !afterColumnNames.has(n));

    if (addedColumns.length > 0 || removedColumns.length > 0) {
      changedTables.push({ table: name, addedColumns, removedColumns });
    }
  }

  return { addedTables, removedTables, changedTables };
}

function declaredColumnNames(table: TableDefinition<any, any>): string[] {
  return (Object.values(table.columns) as ColumnBuilder<any, any, any>[]).map((c) => c.name);
}
