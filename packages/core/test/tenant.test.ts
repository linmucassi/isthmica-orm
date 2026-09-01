import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { serial, text } from "../src/column.js";
import { table, type InferDatabase } from "../src/table.js";
import { tenantScoped } from "../src/tenant.js";

const orders = table("orders", {
  id: serial("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  status: text("status").notNull(),
});

type DB = InferDatabase<{ orders: typeof orders }>;

function createTestDb(): Kysely<DB> {
  // Compile-only — no live Postgres required (pg.Pool connects lazily).
  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new Pool({ host: "unused", max: 0 }) }),
  });
}

describe("tenantScoped", () => {
  it("compiles once .forTenant() has been applied, filtering on the tenant column", () => {
    const db = createTestDb();
    const { sql, parameters } = tenantScoped(db, "orders", "tenant_id")
      .where("status", "=", "open")
      .forTenant("tenant-1")
      .compile();

    expect(sql).toContain('"status" = $1');
    expect(sql).toContain('"tenant_id" = $2');
    expect(parameters).toEqual(["open", "tenant-1"]);
  });

  it("applies the tenant filter regardless of where in the chain .forTenant() is called", () => {
    const db = createTestDb();
    const { sql } = tenantScoped(db, "orders", "tenant_id").forTenant("tenant-1").where("status", "=", "open").compile();
    expect(sql).toContain('"tenant_id" = $1');
    expect(sql).toContain('"status" = $2');
  });

  it("does NOT typecheck without .forTenant() — this is the actual guarantee being tested", () => {
    // This assertion only means anything if `npm run typecheck` actually
    // runs — vitest transpiles via esbuild and never type-checks, so a
    // `@ts-expect-error` here is inert at runtime by itself. See the note
    // in tenant.ts and docs/known-risks.md: this repo has no CI enforcing
    // `tsc --noEmit` yet, so this guarantee is only real if a human (or a
    // future CI job) runs it before merging.
    const scoped = tenantScoped(createTestDb(), "orders", "tenant_id").where("status", "=", "open");

    // @ts-expect-error — .execute() must not be callable before .forTenant()
    scoped.execute();
    // @ts-expect-error — same for .compile()
    scoped.compile();
    // @ts-expect-error — same for .executeTakeFirst()
    scoped.executeTakeFirst();

    expect(true).toBe(true); // this test's real assertion is `npm run typecheck` passing
  });
});
