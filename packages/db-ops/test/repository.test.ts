import Database from "better-sqlite3";
import { Kysely, SqliteDialect, sql } from "kysely";
import { beforeEach, describe, expect, it } from "vitest";
import { serial, table, text, timestamp, withSoftDelete, type InferDatabase } from "@isthmica/core";
import { createRepository } from "../src/repository.js";

// A real, in-process SQLite database (no live Postgres required — see
// docs/best-practices.md#testing-without-a-live-database) so these tests
// exercise actual insert/select/update/delete round trips, not just
// compiled SQL text. Isthmica has no migrations engine yet, so the schema
// is created here directly with Kysely's schema builder.

const orders = table(
  "orders",
  {
    id: serial("id").primaryKey(),
    status: text("status").notNull(),
    createdAt: timestamp("createdAt").defaultNow(),
  },
  { softDelete: true },
);

const tags = table("tags", {
  id: serial("id").primaryKey(),
  label: text("label").notNull(),
});

const tables = { orders, tags };
type DB = InferDatabase<typeof tables>;

function createTestDb(): Kysely<DB> {
  return new Kysely<DB>({ dialect: new SqliteDialect({ database: new Database(":memory:") }) });
}

async function createSchema(db: Kysely<DB>): Promise<void> {
  await db.schema
    .createTable("orders")
    .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
    .addColumn("status", "text", (c) => c.notNull())
    .addColumn("createdAt", "text")
    // deleted_at isn't part of the `orders` table() definition above — the
    // soft-delete plugin targets it by raw column name regardless of
    // whether it's declared in the schema DSL. See docs/soft-delete.md.
    .addColumn("deleted_at", "text")
    .execute();

  await db.schema
    .createTable("tags")
    .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
    .addColumn("label", "text", (c) => c.notNull())
    .execute();
}

describe("createRepository", () => {
  let db: Kysely<DB>;

  beforeEach(async () => {
    db = createTestDb();
    await createSchema(db);
  });

  it("inserts, gets, updates, and hard-deletes a row on a non-soft-delete table", async () => {
    const repo = createRepository(db, tags);

    const inserted = await repo.insert({ label: "first" });
    expect(inserted.label).toBe("first");
    expect(inserted.id).toEqual(expect.any(Number));

    const fetched = await repo.get(inserted.id);
    expect(fetched?.label).toBe("first");

    const updated = await repo.update(inserted.id, { label: "renamed" });
    expect(updated?.label).toBe("renamed");

    await repo.delete(inserted.id);
    expect(await repo.get(inserted.id)).toBeUndefined();
  });

  it("soft-deletes instead of hard-deleting when the table declares softDelete", async () => {
    const scopedDb = withSoftDelete(db, tables);
    const repo = createRepository(scopedDb, orders);

    const inserted = await repo.insert({ status: "open" });
    await repo.delete(inserted.id);

    // the soft-delete-scoped repository no longer sees it...
    expect(await repo.get(inserted.id)).toBeUndefined();

    // ...but the row is still physically present, not gone
    const raw = await sql<{ deleted_at: string | null }>`select deleted_at from orders where id = ${inserted.id}`.execute(
      db,
    );
    expect(raw.rows[0]?.deleted_at).not.toBeNull();
  });

  it("throws at creation time if the configured primary key column doesn't exist", () => {
    expect(() => createRepository(db, tags, { primaryKey: "nope" as never })).toThrow(/primary key/i);
  });
});
