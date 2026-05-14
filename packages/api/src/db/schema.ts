import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const scrapes = sqliteTable("scrapes", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    url: text("url").notNull(),
    profile: text("profile").notNull(),
    status: integer("status"),
    content: text("content"),
    metadata: text("metadata"), // Store as JSON string
    createdAt: text("created_at").default("CURRENT_TIMESTAMP"),
});

export const cookieJars = sqliteTable("cookie_jars", {
    id: text("id").primaryKey(),
    data: text("data").notNull(), // Store as JSON string
    updatedAt: text("updated_at").default("CURRENT_TIMESTAMP"),
});
