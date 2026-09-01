export { pg, pool, connect as connectPg, type PgConnectionOptions } from "./pg.js";
export { prisma, type PrismaConnectionOptions } from "./prisma.js";
export {
  createRepository,
  type Repository,
  type RepositoryOptions,
} from "./repository.js";

// Convenience: re-exports everything @isthmica/core already exports, so a
// project that only needs the schema DSL + soft delete + db-ops doesn't
// need two separate import statements. @isthmica/core is unaffected by
// this and remains fully usable on its own — this is purely additive.
export * from "@isthmica/core";

import { pg } from "./pg.js";
import { prisma } from "./prisma.js";

/** `isthmica.pg.connect(...)`, `isthmica.prisma.connect(...)`, etc. */
const isthmica = { pg, prisma };
export default isthmica;
