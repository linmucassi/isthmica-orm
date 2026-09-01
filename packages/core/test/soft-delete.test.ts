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

describe("soft delete plugin — reads", () => {
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
    // Column reference uses the real declared name ("tenant_id"), not the
    // object key ("tenantId") — see the column-name-keying note in
    // table.ts / docs/schema-dsl.md.
    const { sql } = db
      .selectFrom("orders")
      .innerJoin("tenants", "tenants.id", "orders.tenant_id")
      .selectAll()
      .compile();
    expect(sql).toContain('"orders"."deleted_at" is null');
    expect(sql).not.toContain('"tenants"."deleted_at"');
  });

  it("references a column by its declared name, not the object key used in the columns record", () => {
    const db = withSoftDelete(createTestDb(), tables);
    // "tenantId" (the object key) is not a valid reference here at all
    // anymore — only "tenant_id" (the declared name) typechecks, which is
    // itself part of what this test is confirming.
    const { sql } = db.selectFrom("orders").select("tenant_id").compile();
    expect(sql).toContain('"tenant_id"');
    expect(sql).not.toContain('"tenantId"');
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

  it("references the alias, not the real table name, when the table is aliased", () => {
    // A real bug until this was fixed: the filter used to reference the
    // real table name even when the query aliased it, producing SQL that
    // references an identifier out of scope after aliasing (a genuine SQL
    // error against a live database — only the alias is valid there).
    const db = withSoftDelete(createTestDb(), tables);
    const { sql } = db.selectFrom("orders as o").selectAll().compile();
    expect(sql).toContain('"o"."deleted_at" is null');
    expect(sql).not.toContain('"orders"."deleted_at"');
  });
});

describe("soft delete plugin — writes (UPDATE)", () => {
  it("scopes an UPDATE against a soft-delete table the same way a SELECT is scoped", () => {
    const db = withSoftDelete(createTestDb(), tables);
    const { sql } = db.updateTable("orders").set({ status: "shipped" }).compile();
    expect(sql).toContain('"deleted_at" is null');
  });

  it("ANDs the filter onto an UPDATE's existing where clause", () => {
    const db = withSoftDelete(createTestDb(), tables);
    const { sql } = db
      .updateTable("orders")
      .set({ status: "shipped" })
      .where("id", "=", 1)
      .compile();
    expect(sql).toContain('"id" = $2');
    expect(sql).toContain('"deleted_at" is null');
  });

  it("leaves an UPDATE against a non-soft-delete table untouched", () => {
    const db = withSoftDelete(createTestDb(), tables);
    const { sql } = db.updateTable("tenants").set({ name: "Acme" }).compile();
    expect(sql).not.toContain("deleted_at");
  });

  it("withDeleted() bypasses UPDATE scoping too — softDeleteUpdate relies on this", () => {
    const db = withSoftDelete(createTestDb(), tables);
    const { sql } = withDeleted(db).updateTable("orders").set({ status: "shipped" }).compile();
    expect(sql).not.toContain("deleted_at");
  });
});
