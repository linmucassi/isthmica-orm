import { Kysely, MysqlDialect } from "kysely";
import type { Pool as MysqlPool, PoolOptions } from "mysql2";

/**
 * Same connection options `mysql2.createPool` already accepts — a
 * connection string or discrete credential fields (`{ host, port, user,
 * password, database, ... }`), plus pool tuning (`connectionLimit`, ...).
 * Isthmica doesn't reinvent this; it's `mysql2`'s own `PoolOptions` type,
 * passed straight through.
 *
 * Uses the callback-style `mysql2` API (`import ... from "mysql2"`, not
 * `"mysql2/promise"`) — Kysely's `MysqlDialectConfig.pool` is typed
 * against its own minimal structural interface (`getConnection(callback)`,
 * `end(callback)`), matching the callback API's shape, not the promise
 * one. This is the standard, documented Kysely+mysql2 pairing.
 */
export type MysqlConnectionOptions = PoolOptions;

/**
 * `mysql2` is loaded via dynamic `import()`, not a static top-level
 * import — unlike `pg.ts` (where `pg` is the assumed default dialect
 * throughout this project's docs), `mysql2` is a genuinely optional
 * add-on, and a static import would force it to be installed just to
 * import *anything* from `@isthmica/db-ops`, even code that never touches
 * MySQL. Same reasoning `prisma.ts` already uses; both `pool()` and
 * `connect()` are `async` as a result.
 */
export async function pool(options: MysqlConnectionOptions): Promise<MysqlPool> {
  const { createPool } = await import("mysql2");
  return createPool(options);
}

/**
 * The actual boilerplate this module exists to remove: everything from
 * `mysql2.createPool` construction through `new Kysely({ dialect: new MysqlDialect(...) })`,
 * in one call. Pass connection options directly, or an already-built pool
 * (e.g. one you're also using outside Kysely) via `{ pool: existingPool }`.
 */
export async function connect<DB>(
  options: MysqlConnectionOptions | { pool: MysqlPool },
): Promise<Kysely<DB>> {
  const resolvedPool = "pool" in options ? options.pool : await pool(options);
  return new Kysely<DB>({ dialect: new MysqlDialect({ pool: resolvedPool }) });
}

export const mysql = { pool, connect };
