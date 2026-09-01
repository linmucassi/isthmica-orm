import Database from "better-sqlite3";
import { serial, table, text, type InferDatabase } from "@isthmica/core";
import { Kysely, SqliteDialect } from "kysely";
import { describe, expect, it } from "vitest";
import { generateCreateTable } from "../src/ddl.js";
import { applyMigration } from "../src/migrate.js";

const ordersV1 = table("orders", {
  id: serial("id").primaryKey(),
  status: text("status").notNull(),
});

const ordersV2 = table("orders", {
  id: serial("id").primaryKey(),
  status: text("status").notNull(),
  // Nullable — adding a NOT NULL column to a table that may already have
  // rows fails at the database level without a default value (see the
  // dedicated test below documenting that boundary). This first
  // migrations slice doesn't do expand/contract splitting for that case
  // (assisted expand/contract is a separate, larger Phase 1 item — see
  // docs/roadmap.md), so tests exercising "add a column, keep working"
  // use a nullable column deliberately.
  tenantId: text("tenant_id"),
});

type DBV2 = InferDatabase<{ orders: typeof ordersV2 }>;

function createTestDb(): Kysely<DBV2> {
  return new Kysely<DBV2>({ dialect: new SqliteDialect({ database: new Database(":memory:") }) });
}

describe("applyMigration", () => {
  it("creates a brand-new table from an empty starting schema", async () => {
    const db = createTestDb();
    await applyMigration(db, [], [ordersV1], { dialect: "sqlite" });

    const inserted = await db
      .insertInto("orders" as any)
      .values({ status: "open" } as any)
      .returningAll()
      .executeTakeFirstOrThrow();
    expect(inserted.status).toBe("open");
  });

  it("adds a column to an existing table without losing existing data", async () => {
    const db = createTestDb();
    await generateCreateTable(db, ordersV1, { dialect: "sqlite" }).execute();
    const inserted = await db
      .insertInto("orders" as any)
      .values({ status: "open" } as any)
      .returningAll()
      .executeTakeFirstOrThrow();

    await applyMigration(db, [ordersV1], [ordersV2], { dialect: "sqlite" });

    // old data survived the ALTER TABLE
    const stillThere = await db
      .selectFrom("orders")
      .selectAll()
      .where("id", "=", inserted.id)
      .executeTakeFirst();
    expect(stillThere?.status).toBe("open");

    // new column is queryable and writable
    const updated = await db
      .updateTable("orders")
      .set({ tenant_id: "t_1" })
      .where("id", "=", inserted.id)
      .returningAll()
      .executeTakeFirst();
    expect(updated?.tenant_id).toBe("t_1");
  });

  it("cannot add a NOT NULL column without a default to a table with existing rows — a real, current limitation", async () => {
    // Every existing row would get NULL for the new column, violating the
    // constraint being added in the same statement — SQLite (and every
    // real database) rejects this outright. This first migrations slice
    // doesn't do expand/contract splitting (add nullable -> backfill ->
    // add constraint) to work around it — that's a deliberately separate,
    // larger Phase 1 item (docs/roadmap.md), not silently solved here.
    // This test exists so that boundary is a visible, intentional
    // regression check, not an undocumented surprise.
    const notNullAddition = table("orders", {
      id: serial("id").primaryKey(),
      status: text("status").notNull(),
      tenantId: text("tenant_id").notNull(),
    });

    const db = createTestDb();
    await generateCreateTable(db, ordersV1, { dialect: "sqlite" }).execute();
    await db.insertInto("orders" as any).values({ status: "open" } as any).execute();

    await expect(
      applyMigration(db, [ordersV1], [notNullAddition], { dialect: "sqlite" }),
    ).rejects.toThrow();
  });

  it("drops a removed column", async () => {
    const db = createTestDb();
    await generateCreateTable(db, ordersV2, { dialect: "sqlite" }).execute();

    await applyMigration(db, [ordersV2], [ordersV1], { dialect: "sqlite" });

    // tenant_id column is gone — a query referencing it now fails
    await expect(
      db.selectFrom("orders" as any).select("tenant_id" as any).execute(),
    ).rejects.toThrow();
  });

  it("drops a removed table", async () => {
    const db = createTestDb();
    await generateCreateTable(db, ordersV1, { dialect: "sqlite" }).execute();

    await applyMigration(db, [ordersV1], [], { dialect: "sqlite" });

    await expect(db.selectFrom("orders" as any).selectAll().execute()).rejects.toThrow();
  });
});
