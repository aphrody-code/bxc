import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit configuration for the Bxc server database.
 *
 * Schema: src/server/db/schema.ts (drizzle-orm/sqlite-core — `scrapes`, `cookie_jars`).
 * DB path: BXC_DB_PATH override (mirrors src/db/BxcDB.ts), defaulting to data/bxc.sqlite.
 */
export default defineConfig({
	dialect: "sqlite",
	schema: "./src/server/db/schema.ts",
	out: "./drizzle",
	dbCredentials: {
		url: process.env.BXC_DB_PATH ?? "./data/bxc.sqlite",
	},
});
