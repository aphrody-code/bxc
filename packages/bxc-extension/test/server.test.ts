import { describe, it, expect } from "bun:test";

describe("Bxc Extension Environment", () => {
    it("should have Zod available", async () => {
        const { z } = await import("zod");
        const schema = z.string();
        expect(schema.parse("test")).toBe("test");
    });

    it("should have access to bun:sqlite", () => {
        const { Database } = require("bun:sqlite");
        const db = new Database(":memory:");
        db.run("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
        db.run("INSERT INTO test (name) VALUES ('bxc')");
        const row = db.query("SELECT * FROM test").get() as { name: string };
        expect(row.name).toBe("bxc");
        db.close();
    });
});
