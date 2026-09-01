import { Kysely, PostgresDialect } from "kysely";
import { Pool, type Pool as PgPool, type PoolConfig } from "pg";

/**
 * Same connection options `pg.Pool` already accepts — a connection string
 * (`{ connectionString: "postgres://..." }`) or discrete credential fields
 * (`{ host, port, user, password, database, ... }`), plus pool tuning
 * (`max`, `idleTimeoutMillis`, `ssl`, ...). Isthmica doesn't reinvent this;
 * it's `pg`'s own `PoolConfig` type, passed straight through.
 */
export type PgConnectionOptions = PoolConfig;

/** Just the pool — for when you want to share it with non-Kysely `pg` code too. */
export function pool(options: PgConnectionOptions): PgPool {
  return new Pool(options);
}

/**
 * The actual boilerplate this module exists to remove: everything from
 * `pg.Pool` construction through `new Kysely({ dialect: new PostgresDialect(...) })`,
 * in one call. Pass connection options directly, or an already-built `Pool`
 * (e.g. one you're also using outside Kysely) via `{ pool: existingPool }`.
 */
export function connect<DB>(options: PgConnectionOptions | { pool: PgPool }): Kysely<DB> {
  const resolvedPool = "pool" in options ? options.pool : pool(options);
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool: resolvedPool }) });
}

export const pg = { pool, connect };
