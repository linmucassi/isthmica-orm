import Database from "better-sqlite3";
import { serial, table, text, timestamp, type InferDatabase } from "@isthmica/core";
import { Kysely, SqliteDialect } from "kysely";
import { describe, expect, it } from "vitest";
import { generateCreateTable } from "../src/ddl.js";
import { generateRangePartition } from "../src/partition.js";

// Compile-only — same justification as @isthmica/core's soft-delete tests:
// there's no live Postgres anywhere in this project, and Postgres is the
// only dialect partitionBy supports (see docs/known-risks.md — this is
// documented as unverified against a live database, same honesty bar
// already applied to the soft-delete plugin).

const events = table(
  "events",
  {
    id: serial("id").primaryKey(),
    occurredAt: timestamp("created_at").notNull(),
  },
  { partitionBy: { type: "range", column: "created_at", interval: "month" } },
);

type DB = InferDatabase<{ events: typeof events }>;

function createTestDb(): Kysely<DB> {
  return new Kysely<DB>({ dialect: new SqliteDialect({ database: new Database(":memory:") }) });
}

describe("generateCreateTable — partitionBy", () => {
  it("appends PARTITION BY RANGE to the CREATE TABLE for postgres", () => {
    const db = createTestDb();
    const { sql } = generateCreateTable(db, events, { dialect: "postgres" }).compile();
    expect(sql).toContain('create table "events"');
    expect(sql).toContain('partition by range ("created_at")');
  });

  it("throws for sqlite — partitionBy is Postgres-only, not silently ignored", () => {
    const db = createTestDb();
    expect(() => generateCreateTable(db, events, { dialect: "sqlite" })).toThrow(/postgres-only/i);
  });

  it("a table without partitionBy is unaffected", () => {
    const plain = table("tags", { id: serial("id").primaryKey(), label: text("label").notNull() });
    const db = createTestDb();
    const { sql } = generateCreateTable(db, plain, { dialect: "postgres" }).compile();
    expect(sql).not.toContain("partition by");
  });
});

describe("generateRangePartition", () => {
  it("compiles CREATE TABLE ... PARTITION OF ... FOR VALUES FROM ... TO ...", () => {
    const db = createTestDb();
    const { sql, parameters } = generateRangePartition("events", {
      name: "events_2026_01",
      from: new Date("2026-01-01T00:00:00.000Z"),
      to: new Date("2026-02-01T00:00:00.000Z"),
    }).compile(db);

    expect(sql).toContain('create table "events_2026_01" partition of "events"');
    expect(sql).toContain("for values from (?) to (?)");
    expect(parameters).toEqual(["2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z"]);
  });
});
