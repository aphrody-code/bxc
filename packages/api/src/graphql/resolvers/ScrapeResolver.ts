import "reflect-metadata";
import { Resolver, Query, Mutation, Arg, ObjectType, Field, ID, Int } from "type-graphql";
import { Browser } from "../../../../../src/api/browser.ts";
import { BxcDB } from "../../db/BxcDB.ts";

const db = new BxcDB();

@ObjectType()
export class Scrape {
    @Field(() => ID)
    id!: number;

    @Field()
    url!: string;

    @Field()
    profile!: string;

    @Field(() => Int, { nullable: true })
    status?: number;

    @Field({ nullable: true })
    content?: string;

    @Field()
    createdAt!: string;
}

interface ScrapeRow {
    id: number;
    url: string;
    profile: string;
    status: number | null;
    content: string | null;
    metadata: string | null;
    timestamp: string | null;
}

@Resolver(Scrape)
export class ScrapeResolver {
    @Query(() => [Scrape])
    async recentScrapes(@Arg("limit", () => Int, { defaultValue: 10 }) limit: number): Promise<Scrape[]> {
        const results = db.getRecentScrapes(limit) as ScrapeRow[];
        return results.map((r) => ({
            id: r.id,
            url: r.url,
            profile: r.profile,
            status: r.status ?? undefined,
            content: r.content ?? undefined,
            createdAt: r.timestamp ?? new Date().toISOString(),
        }));
    }

    @Query(() => String)
    health(): string {
        return "⚡️ Bxc API (Modular Type-GraphQL) is healthy";
    }

    @Mutation(() => Scrape)
    async scrape(
        @Arg("url") url: string,
        @Arg("profile", { nullable: true }) profile?: string
    ): Promise<Scrape> {
        const resolvedProfile = profile || "static";
        const page = await Browser.newPage({ profile: resolvedProfile as any });
        try {
            const res = await page.goto(url);
            const content = await page.content();
            const title = await page.title();

            const changes = db.saveScrape(url, resolvedProfile, res.status, content, { title });
            const id = Number(changes.lastInsertRowid);

            return {
                id,
                url,
                profile: resolvedProfile,
                status: res.status,
                content,
                createdAt: new Date().toISOString(),
            };
        } finally {
            await page.close();
        }
    }
}
