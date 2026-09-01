import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { serial, text, timestamp } from "../src/column.js";
import { withDeleted, withSoftDelete } from "../src/db.js";
import { table, type InferDatabase } from "../src/table.js";

const orders = table(
  "orders",
  {
    id: serial("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    status: text("status").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  { softDelete: true },
);

const tenants = table("tenants", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
});

const tables = { orders, tenants };
type DB = InferDatabase<typeof tables>;

function createTestDb(): Kysely<DB> {
  // Never executed against — only used to compile queries to SQL text, so a
  // live Postgres connection is never required. Kysely/pg both connect lazily.
  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new Pool({ host: "unused", max: 0 }) }),
  });
}

describe("soft delete plugin", () => {
  it("adds deleted_at is null to a plain select on a soft-delete table", () => {
    const db = withSoftDelete(createTestDb(), tables);
    const { sql } = db.selectFrom("orders").selectAll().compile();
    expect(sql).toContain('"deleted_at" is null');
  });

  it("leaves tables without softDelete untouched", () => {
    const db = withSoftDelete(createTestDb(), tables);
    const { sql } = db.selectFrom("tenants").selectAll().compile();
    expect(sql).not.toContain("deleted_at");
  });

  it("ANDs the filter onto an existing where clause", () => {
    const db = withSoftDelete(createTestDb(), tables);
    const { sql } = db.selectFrom("orders").selectAll().where("status", "=", "open").compile();
    expect(sql).toContain('"status" = $1');
    expect(sql).toContain('"deleted_at" is null');
    expect(sql).toMatch(/where .*and .*|where .*and .*/i);
  });

  it("filters a soft-delete table on both sides of a join, but not a non-soft-delete join target", () => {
    const db = withSoftDelete(createTestDb(), tables);
    const { sql } = db
      .selectFrom("orders")
      .innerJoin("tenants", "tenants.id", "orders.tenantId")
      .selectAll()
      .compile();
    expect(sql).toContain('"orders"."deleted_at" is null');
    expect(sql).not.toContain('"tenants"."deleted_at"');
  });

  it("withDeleted() bypasses the filter entirely", () => {
    const db = withSoftDelete(createTestDb(), tables);
    const { sql } = withDeleted(db).selectFrom("orders").selectAll().compile();
    expect(sql).not.toContain("deleted_at");
  });

  it("is a no-op when no table declares softDelete", () => {
    const base = createTestDb();
    const db = withSoftDelete(base, { tenants });
    expect(db).toBe(base);
  });
});
