import Database from "better-sqlite3";
import { serial, table, text, timestamp, type InferDatabase, type InferInsert } from "@isthmica/core";
import { Kysely, SqliteDialect } from "kysely";
import { describe, expect, it } from "vitest";
import { generateCreateTable } from "../src/ddl.js";

const orders = table("orders", {
  id: serial("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  status: text("status").notNull(),
  createdAt: timestamp("createdAt").defaultNow(),
});

type DB = InferDatabase<{ orders: typeof orders }>;

function createTestDb(): Kysely<DB> {
  return new Kysely<DB>({ dialect: new SqliteDialect({ database: new Database(":memory:") }) });
}

describe("generateCreateTable", () => {
  it("compiles a CREATE TABLE with correct column names, not-null, and primary key (postgres)", () => {
    const db = createTestDb();
    const { sql } = generateCreateTable(db, orders, { dialect: "postgres" }).compile();
    expect(sql).toContain('create table "orders"');
    expect(sql).toContain('"id" serial not null primary key');
    expect(sql).toContain('"tenant_id" text not null');
    expect(sql).toContain('"status" text not null');
  });

  it("maps serial to integer + autoincrement, and timestamp to text, for sqlite", () => {
    const db = createTestDb();
    const { sql } = generateCreateTable(db, orders, { dialect: "sqlite" }).compile();
    expect(sql).toContain('"id" integer not null primary key autoincrement');
    expect(sql).toContain('"createdAt" text');
    expect(sql).not.toContain("serial");
  });

  it("actually creates a working table — real execution, real insert via InferInsert, real round trip", async () => {
    const db = createTestDb();
    await generateCreateTable(db, orders, { dialect: "sqlite" }).execute();

    const values: InferInsert<(typeof orders)["columns"]> = { tenantId: "t_1", status: "open" };
    const inserted = await db
      .insertInto("orders")
      .values({ tenant_id: values.tenantId, status: values.status })
      .returningAll()
      .executeTakeFirstOrThrow();

    expect(inserted.id).toEqual(expect.any(Number));
    expect(inserted.tenant_id).toBe("t_1");
    expect(inserted.status).toBe("open");

    const fetched = await db
      .selectFrom("orders")
      .selectAll()
      .where("id", "=", inserted.id)
      .executeTakeFirst();
    expect(fetched?.status).toBe("open");
  });

  it("only applies defaultTo(current_timestamp) to non-primary-key timestamp columns with a default", () => {
    const withDefault = table("events", {
      id: serial("id").primaryKey(),
      occurredAt: timestamp("occurred_at").defaultNow(),
    });
    const db = createTestDb();
    const { sql } = generateCreateTable(db, withDefault, { dialect: "postgres" }).compile();
    expect(sql).toContain('"occurred_at" timestamp default current_timestamp');
    expect(sql).not.toContain('"id" serial primary key default');
  });
});
