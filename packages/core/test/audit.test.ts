import Database from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { serial, text } from "../src/column.js";
import { withAudit } from "../src/db.js";
import { table, type InferDatabase } from "../src/table.js";
import type { AuditEvent } from "../src/plugins/audit.js";

const orders = table(
  "orders",
  { id: serial("id").primaryKey(), status: text("status").notNull() },
  { audit: true },
);

const tags = table("tags", { id: serial("id").primaryKey(), label: text("label").notNull() });

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
    .execute();
  await db.schema
    .createTable("tags")
    .addColumn("id", "integer", (c) => c.primaryKey().autoIncrement())
    .addColumn("label", "text", (c) => c.notNull())
    .execute();
}

describe("audit plugin", () => {
  let raw: Kysely<DB>;
  let sink: ReturnType<typeof vi.fn<(event: AuditEvent) => void>>;
  let db: Kysely<DB>;

  beforeEach(async () => {
    raw = createTestDb();
    await createSchema(raw);
    sink = vi.fn();
    db = withAudit(raw, tables, sink);
  });

  it("captures an insert's post-image and calls the sink", async () => {
    const inserted = await db.insertInto("orders").values({ status: "open" }).returningAll().executeTakeFirstOrThrow();

    expect(sink).toHaveBeenCalledTimes(1);
    const event = sink.mock.calls[0]![0];
    expect(event.table).toBe("orders");
    expect(event.operation).toBe("insert");
    expect(event.newValues).toEqual([{ id: inserted.id, status: "open" }]);
    expect(event.occurredAt).toBeInstanceOf(Date);
  });

  it("captures an update's post-image", async () => {
    const inserted = await db.insertInto("orders").values({ status: "open" }).returningAll().executeTakeFirstOrThrow();
    sink.mockClear();

    await db.updateTable("orders").set({ status: "shipped" }).where("id", "=", inserted.id).execute();

    expect(sink).toHaveBeenCalledTimes(1);
    const event = sink.mock.calls[0]![0];
    expect(event.operation).toBe("update");
    expect(event.newValues).toEqual([{ id: inserted.id, status: "shipped" }]);
  });

  it("captures a delete's post-image (the row as it was, injected via returning *)", async () => {
    const inserted = await db.insertInto("orders").values({ status: "open" }).returningAll().executeTakeFirstOrThrow();
    sink.mockClear();

    await db.deleteFrom("orders").where("id", "=", inserted.id).execute();

    expect(sink).toHaveBeenCalledTimes(1);
    const event = sink.mock.calls[0]![0];
    expect(event.operation).toBe("delete");
    expect(event.newValues).toEqual([{ id: inserted.id, status: "open" }]);
  });

  it("does not call the sink for a table that isn't audited", async () => {
    await db.insertInto("tags").values({ label: "x" }).execute();
    expect(sink).not.toHaveBeenCalled();
  });

  it("respects a caller-narrowed .returning(...) — a documented limitation, not a silent gap", async () => {
    const inserted = await db
      .insertInto("orders")
      .values({ status: "open" })
      .returning(["status"])
      .executeTakeFirstOrThrow();

    expect(inserted).toEqual({ status: "open" });
    expect(sink).toHaveBeenCalledTimes(1);
    // narrowed the same way the query itself was narrowed — no "id" here
    expect(sink.mock.calls[0]![0].newValues).toEqual([{ status: "open" }]);
  });

  it("withAudit is a no-op when no table declares audit: true", () => {
    const noAudit = withAudit(raw, { tags }, sink);
    expect(noAudit).toBe(raw);
  });
});
