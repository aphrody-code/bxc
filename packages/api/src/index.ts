import "reflect-metadata";
import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { logger } from "@bogeychan/elysia-logger";
import { createYoga } from "graphql-yoga";
import { buildSchema } from "type-graphql";
import { ScrapeResolver } from "./graphql/resolvers/ScrapeResolver.ts";
import { Browser } from "../../../src/api/browser.ts";

async function bootstrap() {
    // 1. Build Type-GraphQL Schema
    const schema = await buildSchema({
        resolvers: [ScrapeResolver],
        validate: false,
    });

    const yoga = createYoga({ schema });

    // 2. Initialize Elysia
    const app = new Elysia()
        .use(cors())
        .use(logger())
        .use(swagger({
            path: "/swagger",
            documentation: {
                info: {
                    title: "Bunlight API",
                    description: "High-performance browser automation (REST + Type-GraphQL + Drizzle)",
                    version: "0.2.0"
                }
            }
        }))
        
        // --- Static Routes ---
        .get("/", () => ({ status: "Bunlight API v0.2.0", docs: "/swagger", graphql: "/graphql" }))
        .get("/health", () => "OK")
        
        // --- REST API ---
        .group("/api/v1", (app) => 
            app.post("/scrape", async ({ body }) => {
                const { url, profile } = body as { url: string, profile?: string };
                const page = await Browser.newPage({ profile: (profile || "static") as any });
                try {
                    const res = await page.goto(url);
                    return {
                        url,
                        status: res.status,
                        title: await page.title(),
                        content: await page.content()
                    };
                } finally {
                    await page.close();
                }
            }, {
                body: t.Object({
                    url: t.String(),
                    profile: t.Optional(t.String())
                })
            })
        )

        // --- GraphQL API ---
        .all("/graphql", async ({ request }) => yoga.handle(request))
        
        .listen(process.env.PORT || 3000);

    console.log("🚀 Bunlight API (Production Ready) running at " + app.server?.hostname + ":" + app.server?.port);
}

bootstrap();
