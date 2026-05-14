import "reflect-metadata";
import { Resolver, Query, Mutation, Arg, ObjectType, Field, ID, Int } from "type-graphql";
import { Browser } from "../../../../../../src/api/browser.ts";
import { BunlightDB } from "../../db/BunlightDB.ts";

const db = new BunlightDB();

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

@Resolver(Scrape)
export class ScrapeResolver {
    @Query(() => [Scrape])
    async recentScrapes(@Arg("limit", () => Int, { defaultValue: 10 }) limit: number): Promise<Scrape[]> {
        const results = await db.getRecentScrapes(limit);
        return results.map(r => ({
            ...r,
            createdAt: r.createdAt || new Date().toISOString()
        })) as any;
    }

    @Query(() => String)
    health(): string {
        return "⚡️ Bunlight API (Modular Type-GraphQL) is healthy";
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
            
            const [saved] = await db.saveScrape(url, resolvedProfile, res.status, content, { title });
            
            return {
                ...saved,
                createdAt: saved.createdAt || new Date().toISOString()
            } as any;
        } finally {
            await page.close();
        }
    }
}
