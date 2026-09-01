export { pg, pool, connect as connectPg, type PgConnectionOptions } from "./pg.js";
export { prisma, type PrismaConnectionOptions } from "./prisma.js";
export { mysql, type MysqlConnectionOptions } from "./mysql.js";
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

import { mysql } from "./mysql.js";
import { pg } from "./pg.js";
import { prisma } from "./prisma.js";

/** `isthmica.pg.connect(...)`, `isthmica.prisma.connect(...)`, `isthmica.mysql.connect(...)`. */
const isthmica = { pg, prisma, mysql };
export default isthmica;
