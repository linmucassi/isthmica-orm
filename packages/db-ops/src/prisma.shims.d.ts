/**
 * Minimal ambient shapes for `@isthmica/db-ops`'s optional Prisma peer
 * dependencies (`@prisma/client`, `@prisma/adapter-pg`, `prisma-extension-kysely`),
 * so `prisma.ts` can typecheck in this repo without those packages actually
 * installed here. Deliberately NOT bundled into the published `.d.ts` (only
 * files reachable from `src/index.ts`'s exports are — verified at build
 * time; if you add an import of this file from index.ts, re-verify).
 *
 * A consumer with the real packages installed gets their real, richer
 * types when they import from "@prisma/client" etc. directly — these shims
 * only exist for this package's own internal `import()` calls.
 */
declare module "@prisma/client" {
  export class PrismaClient {
    constructor(options?: { adapter?: unknown });
    $extends(extension: unknown): { $kysely: unknown };
  }
}

declare module "@prisma/adapter-pg" {
  export class PrismaPg {
    constructor(options: { connectionString: string });
  }
}

declare module "prisma-extension-kysely" {
  const kyselyExtension: (options: { kysely: (driver: unknown) => unknown }) => unknown;
  export default kyselyExtension;
}
