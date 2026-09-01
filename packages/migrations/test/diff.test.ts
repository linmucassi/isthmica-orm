import { serial, table, text } from "@isthmica/core";
import { describe, expect, it } from "vitest";
import { diffSchemas } from "../src/diff.js";

const ordersV1 = table("orders", {
  id: serial("id").primaryKey(),
  status: text("status").notNull(),
});

const ordersV2 = table("orders", {
  id: serial("id").primaryKey(),
  status: text("status").notNull(),
  tenantId: text("tenant_id").notNull(),
});

const tags = table("tags", {
  id: serial("id").primaryKey(),
  label: text("label").notNull(),
});

describe("diffSchemas", () => {
  it("detects an added table", () => {
    const diff = diffSchemas([ordersV1], [ordersV1, tags]);
    expect(diff.addedTables).toEqual(["tags"]);
    expect(diff.removedTables).toEqual([]);
    expect(diff.changedTables).toEqual([]);
  });

  it("detects a removed table", () => {
    const diff = diffSchemas([ordersV1, tags], [ordersV1]);
    expect(diff.removedTables).toEqual(["tags"]);
    expect(diff.addedTables).toEqual([]);
  });

  it("detects an added column by declared name, keyed off column.name not the object key", () => {
    const diff = diffSchemas([ordersV1], [ordersV2]);
    expect(diff.changedTables).toEqual([
      { table: "orders", addedColumns: ["tenant_id"], removedColumns: [] },
    ]);
  });

  it("detects a removed column", () => {
    const diff = diffSchemas([ordersV2], [ordersV1]);
    expect(diff.changedTables).toEqual([
      { table: "orders", addedColumns: [], removedColumns: ["tenant_id"] },
    ]);
  });

  it("treats a renamed column as a drop+add pair, not a rename — deliberate, documented non-solution", () => {
    const renamed = table("orders", {
      id: serial("id").primaryKey(),
      status: text("status").notNull(),
      customerId: text("customer_id").notNull(), // was "tenant_id" in ordersV2
    });
    const diff = diffSchemas([ordersV2], [renamed]);
    expect(diff.changedTables).toEqual([
      { table: "orders", addedColumns: ["customer_id"], removedColumns: ["tenant_id"] },
    ]);
  });

  it("reports no changes when schemas are identical", () => {
    const diff = diffSchemas([ordersV1, tags], [ordersV1, tags]);
    expect(diff).toEqual({ addedTables: [], removedTables: [], changedTables: [] });
  });
});
