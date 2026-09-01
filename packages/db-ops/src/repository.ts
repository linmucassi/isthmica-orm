import type { Kysely } from "kysely";
import {
  softDeleteUpdate,
  type ColumnBuilder,
  type InferInsert,
  type InferSelect,
  type InferUpdate,
  type TableDefinition,
} from "@isthmica/core";

type AnyColumns = Record<string, ColumnBuilder<any, any, any>>;

export interface RepositoryOptions<TColumns extends AnyColumns, TPrimaryKey extends keyof TColumns> {
  /**
   * Which column identifies a row, by its object key in the `table()`
   * definition (not the string passed to `text()`/`serial()`/etc. — see
   * docs/schema-dsl.md's naming note). Defaults to `"id"` if the table has
   * a column at that key. Isthmica doesn't track "is this the primary key"
   * at the type level (only as runtime metadata on `ColumnBuilder`), so
   * beyond that convention it can't be auto-detected — pass this explicitly
   * for tables whose id column isn't literally `id`. Composite keys aren't
   * supported: pick the single column that uniquely identifies a row.
   */
  readonly primaryKey?: TPrimaryKey;
}

export interface Repository<
  DB,
  TName extends keyof DB & string,
  TColumns extends AnyColumns,
  TPrimaryKey extends keyof TColumns,
> {
  get(id: TColumns[TPrimaryKey]["$selectType"]): Promise<InferSelect<TColumns> | undefined>;
  insert(values: InferInsert<TColumns>): Promise<InferSelect<TColumns>>;
  update(
    id: TColumns[TPrimaryKey]["$selectType"],
    values: InferUpdate<TColumns>,
  ): Promise<InferSelect<TColumns> | undefined>;
  delete(id: TColumns[TPrimaryKey]["$selectType"]): Promise<void>;
}

/**
 * Thin, optional CRUD ergonomics over a single table: get/insert/update/delete
 * without hand-writing the same `selectFrom`/`insertInto`/`updateTable` shape
 * at every call site. This is a convenience layer, not a new query
 * capability — everything it does is a plain Kysely query you could write
 * yourself, and dropping to `db` directly for anything more complex
 * (filtering, joins, pagination) is expected and normal.
 *
 * `delete` is soft-delete-aware: if the table declared `softDelete: true`,
 * it calls `softDeleteUpdate` (see @isthmica/core's docs/soft-delete.md);
 * otherwise it issues a real `DELETE`.
 *
 * Kysely's `.where()`/`.set()`/`.values()` overloads don't unify for a
 * dynamically-named table/column the way this generic function needs them
 * to — same pragmatic escape hatch `softDeleteUpdate` in `@isthmica/core`
 * uses internally. The public `Repository<...>` return type stays fully
 * typed; only this function's internal plumbing is loose.
 *
 * Since `@isthmica/core`'s `InferSelect`/`InferInsert`/`InferUpdate` are
 * keyed by object key (e.g. `tenantId`) while Kysely's actual compiled
 * queries reference each column's declared name (e.g. `tenant_id`) — see
 * the naming note in docs/schema-dsl.md — this function translates between
 * the two at its boundary: `toRawRecord` before every write, `fromRawRow`
 * after every read. Nothing outside this file needs to know that
 * translation happens; `Repository`'s public shape is entirely object-key
 * (JS-facing), matching `$inferSelect`/`$inferInsert` everywhere else.
 */
export function createRepository<
  DB,
  TName extends keyof DB & string,
  TColumns extends AnyColumns,
  TPrimaryKey extends keyof TColumns = "id" extends keyof TColumns ? "id" : never,
>(
  db: Kysely<DB>,
  table: TableDefinition<TName, TColumns>,
  options: RepositoryOptions<TColumns, TPrimaryKey> = {},
): Repository<DB, TName, TColumns, TPrimaryKey> {
  const primaryKey = options.primaryKey ?? ("id" as TPrimaryKey);
  const primaryKeyObjectKey = String(primaryKey);
  const primaryKeyColumn = table.columns[primaryKeyObjectKey] as ColumnBuilder<any, any, any> | undefined;
  if (!primaryKeyColumn) {
    throw new Error(
      `createRepository("${table.name}"): primary key column "${primaryKeyObjectKey}" is not defined on this table. Pass { primaryKey: "<column>" } explicitly if it isn't "id".`,
    );
  }
  const primaryKeyRawName = primaryKeyColumn.name;

  const tableName = table.name;
  const anyDb = db as unknown as {
    selectFrom(table: string): any;
    insertInto(table: string): any;
    updateTable(table: string): any;
    deleteFrom(table: string): any;
  };

  return {
    async get(id) {
      const row = await anyDb
        .selectFrom(tableName)
        .selectAll()
        .where(primaryKeyRawName, "=", id)
        .executeTakeFirst();
      return fromRawRow(table, row);
    },
    async insert(values) {
      const row = await anyDb
        .insertInto(tableName)
        .values(toRawRecord(table, values as Record<string, unknown>))
        .returningAll()
        .executeTakeFirstOrThrow();
      return fromRawRow(table, row);
    },
    async update(id, values) {
      // An empty `values` compiles to `SET` with nothing after it — a raw
      // SQL syntax error at the driver, not a validation error, and easy to
      // hit by accident from code that conditionally builds a partial
      // update object. Treat it as a true no-op instead: return the row
      // unchanged rather than letting the driver reject malformed SQL.
      if (Object.keys(values as object).length === 0) {
        return this.get(id);
      }
      const row = await anyDb
        .updateTable(tableName)
        .set(toRawRecord(table, values as Record<string, unknown>))
        .where(primaryKeyRawName, "=", id)
        .returningAll()
        .executeTakeFirst();
      return fromRawRow(table, row);
    },
    async delete(id) {
      if (table.options.softDelete) {
        await (softDeleteUpdate(db, tableName) as any).where(primaryKeyRawName, "=", id).execute();
        return;
      }
      await anyDb.deleteFrom(tableName).where(primaryKeyRawName, "=", id).execute();
    },
  };
}

/** Object-key-shaped values (e.g. `{ tenantId: "x" }`) -> declared-name-shaped (`{ tenant_id: "x" }`). */
function toRawRecord(
  table: TableDefinition<any, any>,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  for (const [objectKey, value] of Object.entries(values)) {
    const column = table.columns[objectKey] as ColumnBuilder<any, any, any> | undefined;
    raw[column?.name ?? objectKey] = value;
  }
  return raw;
}

/** A raw Kysely row (declared-name-shaped) -> object-key-shaped, matching `InferSelect`. */
function fromRawRow(table: TableDefinition<any, any>, row: Record<string, unknown> | undefined): any {
  if (!row) {
    return undefined;
  }
  const result: Record<string, unknown> = {};
  for (const [objectKey, column] of Object.entries(table.columns) as [string, ColumnBuilder<any, any, any>][]) {
    if (column.name in row) {
      result[objectKey] = row[column.name];
    }
  }
  return result;
}
