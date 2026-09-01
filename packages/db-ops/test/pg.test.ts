import { describe, expect, it } from "vitest";
import { pg } from "../src/pg.js";

interface DB {
  orders: { id: number };
}

describe("pg.connect / pg.pool", () => {
  it("connect() produces a working Kysely instance from connection options", () => {
    // Never executed against — pg.Pool connects lazily, so no live
    // Postgres is required to compile a query and inspect its SQL.
    const db = pg.connect<DB>({ host: "unused", max: 0 });
    const { sql } = db.selectFrom("orders").selectAll().compile();
    expect(sql).toBe('select * from "orders"');
  });

  it("connect() accepts an existing pool via { pool }", () => {
    const pool = pg.pool({ host: "unused", max: 0 });
    const db = pg.connect<DB>({ pool });
    const { sql } = db.selectFrom("orders").selectAll().compile();
    expect(sql).toBe('select * from "orders"');
  });

  it("pool() returns a real pg.Pool instance", () => {
    const pool = pg.pool({ host: "unused", max: 0 });
    expect(typeof pool.connect).toBe("function");
    expect(typeof pool.end).toBe("function");
  });
});
