import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, type Driver } from "kysely";

export interface PrismaConnectionOptions {
  readonly connectionString: string;
}

/**
 * Wires Kysely to run through Prisma's own connection (via
 * `@prisma/adapter-pg` + `prisma-extension-kysely`), so credentials and
 * pooling are configured the way a Prisma-based project already configures
 * them, while queries still go through Kysely / Isthmica exactly like the
 * `pg` path (see `pg.ts`).
 *
 * `@prisma/client`, `@prisma/adapter-pg`, and `prisma-extension-kysely` are
 * all optional peer dependencies, loaded via dynamic `import()` so pulling
 * in `@isthmica/db-ops` doesn't force-install Prisma's toolchain for
 * projects that only use the `pg` path.
 *
 * Verified against `prisma-extension-kysely`'s documented v4 API (which
 * requires Prisma 7's driver adapters) — NOT exercised against a live
 * Prisma + Postgres setup, since this repo has no generated Prisma client
 * to test against. Treat this as implemented-per-documentation, not
 * integration-tested. See docs/known-risks.md before relying on it in
 * production.
 */
export async function connect<DB>(options: PrismaConnectionOptions): Promise<Kysely<DB>> {
  const [{ PrismaClient }, { PrismaPg }, { default: kyselyExtension }] = await Promise.all([
    import("@prisma/client"),
    import("@prisma/adapter-pg"),
    import("prisma-extension-kysely"),
  ]);

  const adapter = new PrismaPg({ connectionString: options.connectionString });
  const client = new PrismaClient({ adapter }).$extends(
    kyselyExtension({
      kysely: (driver: unknown) =>
        new Kysely<DB>({
          dialect: {
            createDriver: () => driver as Driver,
            createAdapter: () => new PostgresAdapter(),
            createIntrospector: (introspectedDb) => new PostgresIntrospector(introspectedDb),
            createQueryCompiler: () => new PostgresQueryCompiler(),
          },
        }),
    }),
  );

  return client.$kysely as unknown as Kysely<DB>;
}

export const prisma = { connect };
