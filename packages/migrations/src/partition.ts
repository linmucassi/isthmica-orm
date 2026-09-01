import { sql, type RawBuilder } from "kysely";

export interface GenerateRangePartitionOptions {
  readonly name: string;
  readonly from: Date;
  readonly to: Date;
}

/**
 * Builds `CREATE TABLE <name> PARTITION OF <parentTable> FOR VALUES FROM
 * (...) TO (...)` for one range partition. Postgres-only (matches
 * `partitionBy` in @isthmica/core's TableOptions, which is Postgres-only —
 * see docs/partitioning.md). The result is a `RawBuilder` (from the `sql`
 * tag) — call `.execute(db)` to actually run it, or `.compile(db)` to
 * inspect the SQL first; unlike `generateCreateTable`'s return value, a
 * `RawBuilder` takes `db` as an argument to those methods rather than
 * having one baked in already, so this function doesn't need a `db`
 * parameter of its own.
 *
 * There is no Kysely builder support for `PARTITION OF` at all (unlike
 * `generateCreateTable`'s `CREATE TABLE`, which drives Kysely's schema
 * builder) — confirmed by scanning Kysely's schema-builder surface, not
 * assumed. This is a deliberate, verified exception to "prefer the
 * builder over hand-formatted SQL," using the public `sql` tag (a stable,
 * documented API — not the `@internal`-marked AST node factories
 * soft-delete.ts and audit.ts rely on).
 *
 * Creates exactly one partition per call — no automatic lifecycle
 * management (pre-creating future partitions, dropping old ones on a
 * schedule). That's real infrastructure requiring a scheduler, which
 * doesn't exist in this project; out of scope for this first slice.
 */
export function generateRangePartition(
  parentTable: string,
  options: GenerateRangePartitionOptions,
): RawBuilder<unknown> {
  return sql`create table ${sql.table(options.name)} partition of ${sql.table(parentTable)} for values from (${options.from.toISOString()}) to (${options.to.toISOString()})`;
}
