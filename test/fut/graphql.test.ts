/**
 * Copyright 2026 aphrody-code
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { describe, expect, test } from "bun:test";
import { graphql } from "graphql";
import { buildSchema } from "type-graphql";
import { ScrapeResolver } from "../../src/server/graphql/resolvers/ScrapeResolver.ts";
import { FutResolver } from "../../src/server/graphql/resolvers/FutResolver.ts";

describe("FUT GraphQL Resolvers Integration", () => {
	test("should build schema and execute futStatsSummary query", async () => {
		const schema = await buildSchema({
			resolvers: [ScrapeResolver, FutResolver],
			validate: false,
		});

		const query = `
			query {
				futStatsSummary {
					totalPlayersCrawled
					totalPricesTracked
					averageOverallRating
					positions {
						name
						count
					}
					rarities {
						name
						count
					}
					genders {
						name
						count
					}
				}
			}
		`;

		const result = await graphql({
			schema,
			source: query,
		});

		expect(result.errors).toBeUndefined();
		expect(result.data).toBeDefined();
		const summary = result.data?.futStatsSummary as any;
		expect(summary).toBeDefined();
		expect(typeof summary.totalPlayersCrawled).toBe("number");
		expect(typeof summary.averageOverallRating).toBe("number");
		expect(Array.isArray(summary.positions)).toBe(true);
	});

	test("should execute futPlayers query with filters", async () => {
		const schema = await buildSchema({
			resolvers: [ScrapeResolver, FutResolver],
			validate: false,
		});

		const query = `
			query {
				futPlayers(limit: 5, ratingMin: 80) {
					id
					name
					rating
					position
					playstyles
					playstylesPlus
					classifications
				}
			}
		`;

		const result = await graphql({
			schema,
			source: query,
		});

		expect(result.errors).toBeUndefined();
		expect(result.data).toBeDefined();
		const players = result.data?.futPlayers as any[];
		expect(Array.isArray(players)).toBe(true);
		if (players.length > 0) {
			const player = players[0];
			expect(player.id).toBeDefined();
			expect(player.name).toBeDefined();
			expect(player.rating).toBeGreaterThanOrEqual(80);
			expect(Array.isArray(player.playstyles)).toBe(true);
			expect(Array.isArray(player.playstylesPlus)).toBe(true);
			expect(Array.isArray(player.classifications)).toBe(true);
		}
	});
});
