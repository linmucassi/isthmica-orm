import { describe, expect, it } from "vitest";
import { mysql } from "../src/mysql.js";

interface DB {
  orders: { id: number; status: string };
}

describe("mysql.connect / mysql.pool", () => {
  it("connect() produces a working Kysely instance from connection options", async () => {
    // Never executed against — mysql2's pool connects lazily, so no live
    // MySQL is required to compile a query and inspect its SQL.
    const db = await mysql.connect<DB>({ host: "unused" });
    const { sql } = db.selectFrom("orders").selectAll().where("status", "=", "open").compile();

    // Dialect-specific assertions, not just "it compiles" — MySQL quotes
    // identifiers with backticks and uses `?` placeholders, unlike
    // Postgres's double-quotes and `$1`-style parameters.
    expect(sql).toBe("select * from `orders` where `status` = ?");
    expect(sql).not.toContain('"orders"');
    expect(sql).not.toContain("$1");
  });

  it("connect() accepts an existing pool via { pool }", async () => {
    const pool = await mysql.pool({ host: "unused" });
    const db = await mysql.connect<DB>({ pool });
    const { sql } = db.selectFrom("orders").selectAll().compile();
    expect(sql).toBe("select * from `orders`");
  });

  it("pool() returns a real mysql2 Pool instance", async () => {
    const pool = await mysql.pool({ host: "unused" });
    expect(typeof pool.getConnection).toBe("function");
    expect(typeof pool.end).toBe("function");
  });
});
