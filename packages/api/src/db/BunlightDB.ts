import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema.ts";
import { resolve } from "path";

export class BunlightDB {
    private client;
    public db;

    constructor(path?: string) {
        const dbPath = path ?? process.env.BUNLIGHT_DB_PATH ?? resolve(process.cwd(), "data/bunlight.sqlite");
        
        // Ensure directory exists
        const fs = require("node:fs");
        const dir = resolve(dbPath, "..");
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        this.client = createClient({ url: "file:" + dbPath });
        this.db = drizzle(this.client, { schema });

        // --- Optimisations avancées Bun (via documentation locale) ---
        // 1. Désactiver le WAL persistant pour un nettoyage propre (notamment sur macOS)
        // Note: Drizzle utilise @libsql/client qui gère sa propre config, 
        // mais pour le driver natif Bun on ferait : 
        // db.fileControl(constants.SQLITE_FCNTL_PERSIST_WAL, 0);
    }

    async saveScrape(url: string, profile: string, status: number, content: string, metadata: any) {
        return this.db.insert(schema.scrapes).values({
            url,
            profile,
            status,
            content,
            metadata: JSON.stringify(metadata),
        }).returning();
    }

    async getRecentScrapes(limit = 10) {
        return this.db.query.scrapes.findMany({
            limit,
            orderBy: (scrapes, { desc }) => [desc(scrapes.createdAt)],
        });
    }

    async close() {
        this.client.close();
    }
}
