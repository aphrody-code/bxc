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

import "reflect-metadata";
import {
	Resolver,
	Query,
	Arg,
	ObjectType,
	Field,
	ID,
	Int,
	Float,
} from "type-graphql";
import { Database } from "bun:sqlite";
import { join } from "node:path";

function classifyPlayer(player: any) {
	const tags: string[] = [];
	if (!player) return tags;

	// Pace Classification
	if (player.pac >= 90) tags.push("Speedster");
	else if (player.pac >= 80) tags.push("Fast");

	// Shooting Classification
	if (player.sho >= 85) tags.push("Clinical Finisher");

	// Playmaker Classification
	if (player.pas >= 85 && player.dri >= 85) tags.push("Elite Playmaker");

	// Defensive Classification
	if (player.def >= 85 && player.phy >= 85) tags.push("Defensive Wall");

	// Goalkeeper Classification
	if (player.div >= 85 && player.ref >= 85) tags.push("Wall GK");

	// Playstyles Classification
	let psPlus = player.playstylesPlus || player.playstyles_plus;
	if (typeof psPlus === "string") {
		try {
			psPlus = JSON.parse(psPlus);
		} catch {}
	}
	if (Array.isArray(psPlus) && psPlus.length > 0) {
		tags.push("Playstyles+ Star");
	}

	return tags;
}

@ObjectType()
export class GraphQLFutPlayer {
	@Field(() => ID)
	id!: string;

	@Field()
	name!: string;

	@Field(() => Int)
	rating!: number;

	@Field()
	position!: string;

	@Field({ nullable: true })
	club?: string;

	@Field({ nullable: true })
	nation?: string;

	@Field({ nullable: true })
	league?: string;

	@Field(() => [String])
	playstyles!: string[];

	@Field(() => [String])
	playstylesPlus!: string[];

	@Field(() => Int, { nullable: true })
	pac?: number;

	@Field(() => Int, { nullable: true })
	sho?: number;

	@Field(() => Int, { nullable: true })
	pas?: number;

	@Field(() => Int, { nullable: true })
	dri?: number;

	@Field(() => Int, { nullable: true })
	def?: number;

	@Field(() => Int, { nullable: true })
	phy?: number;

	@Field(() => Int, { nullable: true })
	div?: number;

	@Field(() => Int, { nullable: true })
	han?: number;

	@Field(() => Int, { nullable: true })
	kic?: number;

	@Field(() => Int, { nullable: true })
	ref?: number;

	@Field(() => Int, { nullable: true })
	spd?: number;

	@Field(() => Int, { nullable: true })
	pos?: number;

	@Field(() => Int, { nullable: true })
	skillMoves?: number;

	@Field(() => Int, { nullable: true })
	weakFoot?: number;

	@Field({ nullable: true })
	workrateAttack?: string;

	@Field({ nullable: true })
	workrateDefense?: string;

	@Field()
	url!: string;

	// Biology / Card attributes
	@Field(() => Int, { nullable: true })
	overallRating?: number;

	@Field({ nullable: true })
	dateOfBirth?: string;

	@Field(() => Int, { nullable: true })
	height?: number;

	@Field(() => Int, { nullable: true })
	weight?: number;

	@Field({ nullable: true })
	foot?: string;

	@Field(() => Int, { nullable: true })
	age?: number;

	@Field({ nullable: true })
	rarity?: string;

	@Field({ nullable: true })
	accelerateType?: string;

	@Field({ nullable: true })
	gender?: string;

	@Field(() => [String])
	alternativePositions!: string[];

	// Detailed Stats
	@Field(() => Int, { nullable: true })
	acceleration?: number;

	@Field(() => Int, { nullable: true })
	sprintSpeed?: number;

	@Field(() => Int, { nullable: true })
	agility?: number;

	@Field(() => Int, { nullable: true })
	balance?: number;

	@Field(() => Int, { nullable: true })
	reactions?: number;

	@Field(() => Int, { nullable: true })
	ballControl?: number;

	@Field(() => Int, { nullable: true })
	dribbling?: number;

	@Field(() => Int, { nullable: true })
	composure?: number;

	@Field(() => Int, { nullable: true })
	jumping?: number;

	@Field(() => Int, { nullable: true })
	stamina?: number;

	@Field(() => Int, { nullable: true })
	strength?: number;

	@Field(() => Int, { nullable: true })
	aggression?: number;

	@Field(() => Int, { nullable: true })
	interceptions?: number;

	@Field(() => Int, { nullable: true })
	headingAccuracy?: number;

	@Field(() => Int, { nullable: true })
	defensiveAwareness?: number;

	@Field(() => Int, { nullable: true })
	standingTackle?: number;

	@Field(() => Int, { nullable: true })
	slidingTackle?: number;

	@Field(() => Int, { nullable: true })
	vision?: number;

	@Field(() => Int, { nullable: true })
	crossing?: number;

	@Field(() => Int, { nullable: true })
	fkAccuracy?: number;

	@Field(() => Int, { nullable: true })
	shortPassing?: number;

	@Field(() => Int, { nullable: true })
	longPassing?: number;

	@Field(() => Int, { nullable: true })
	curve?: number;

	@Field(() => Int, { nullable: true })
	positioning?: number;

	@Field(() => Int, { nullable: true })
	finishing?: number;

	@Field(() => Int, { nullable: true })
	shotPower?: number;

	@Field(() => Int, { nullable: true })
	longShots?: number;

	@Field(() => Int, { nullable: true })
	volleys?: number;

	@Field(() => Int, { nullable: true })
	penalties?: number;

	@Field(() => Int, { nullable: true })
	gkDiving?: number;

	@Field(() => Int, { nullable: true })
	gkHandling?: number;

	@Field(() => Int, { nullable: true })
	gkKicking?: number;

	@Field(() => Int, { nullable: true })
	gkReflexes?: number;

	@Field(() => Int, { nullable: true })
	gkPositioning?: number;

	@Field(() => Int, { nullable: true })
	gkSpeed?: number;

	@Field(() => [String])
	classifications!: string[];
}

@ObjectType()
export class GroupCount {
	@Field()
	name!: string;

	@Field(() => Int)
	count!: number;
}

@ObjectType()
export class FutStatsSummary {
	@Field(() => Int)
	totalPlayersCrawled!: number;

	@Field(() => Int)
	totalPricesTracked!: number;

	@Field(() => Float)
	averageOverallRating!: number;

	@Field(() => [GroupCount])
	positions!: GroupCount[];

	@Field(() => [GroupCount])
	rarities!: GroupCount[];

	@Field(() => [GroupCount])
	genders!: GroupCount[];
}

@Resolver()
export class FutResolver {
	@Query(() => [GraphQLFutPlayer])
	async futPlayers(
		@Arg("ratingMin", () => Int, { nullable: true }) ratingMin?: number,
		@Arg("ratingMax", () => Int, { nullable: true }) ratingMax?: number,
		@Arg("position", { nullable: true }) position?: string,
		@Arg("club", { nullable: true }) club?: string,
		@Arg("nation", { nullable: true }) nation?: string,
		@Arg("league", { nullable: true }) league?: string,
		@Arg("rarity", { nullable: true }) rarity?: string,
		@Arg("gender", { nullable: true }) gender?: string,
		@Arg("foot", { nullable: true }) foot?: string,
		@Arg("sortBy", { nullable: true, defaultValue: "rating" }) sortBy?: string,
		@Arg("sortOrder", { nullable: true, defaultValue: "desc" })
		sortOrder?: string,
		@Arg("limit", () => Int, { nullable: true, defaultValue: 50 })
		limit?: number,
		@Arg("offset", () => Int, { nullable: true, defaultValue: 0 })
		offset?: number,
	): Promise<GraphQLFutPlayer[]> {
		const dbPath = join(
			import.meta.dir,
			"../data/fut_extracted_database.sqlite",
		);
		const db = new Database(dbPath);

		let sql = "SELECT * FROM players WHERE 1=1";
		const params: Record<string, any> = {};

		if (ratingMin !== undefined && ratingMin !== null) {
			sql += " AND rating >= $ratingMin";
			params["$ratingMin"] = ratingMin;
		}
		if (ratingMax !== undefined && ratingMax !== null) {
			sql += " AND rating <= $ratingMax";
			params["$ratingMax"] = ratingMax;
		}
		if (position) {
			sql += " AND position = $position";
			params["$position"] = position;
		}
		if (club) {
			sql += " AND club LIKE $club";
			params["$club"] = `%${club}%`;
		}
		if (nation) {
			sql += " AND nation LIKE $nation";
			params["$nation"] = `%${nation}%`;
		}
		if (league) {
			sql += " AND league LIKE $league";
			params["$league"] = `%${league}%`;
		}
		if (rarity) {
			sql += " AND rarity LIKE $rarity";
			params["$rarity"] = `%${rarity}%`;
		}
		if (gender) {
			sql += " AND gender = $gender";
			params["$gender"] = gender;
		}
		if (foot) {
			sql += " AND foot = $foot";
			params["$foot"] = foot;
		}

		const allowedSorts = [
			"overall_rating",
			"rating",
			"pac",
			"sho",
			"pas",
			"dri",
			"def",
			"phy",
		];
		const sortField = allowedSorts.includes(sortBy || "") ? sortBy : "rating";
		const sortDir = (sortOrder || "").toLowerCase() === "asc" ? "ASC" : "DESC";
		sql += ` ORDER BY ${sortField} ${sortDir}`;

		const finalLimit = typeof limit === "number" ? limit : 50;
		const finalOffset = typeof offset === "number" ? offset : 0;
		sql += " LIMIT $limit OFFSET $offset";
		params["$limit"] = finalLimit;
		params["$offset"] = finalOffset;

		const rows = db.query(sql).all(params) as any[];
		return rows.map((row) => {
			let playstyles: string[] = [];
			try {
				playstyles = JSON.parse(row.playstyles || "[]");
			} catch {}

			let playstylesPlus: string[] = [];
			try {
				playstylesPlus = JSON.parse(row.playstyles_plus || "[]");
			} catch {}

			let alternativePositions: string[] = [];
			try {
				alternativePositions = JSON.parse(row.alternative_positions || "[]");
			} catch {}

			const mappedPlayer = {
				id: row.id,
				name: row.name,
				rating: row.rating,
				position: row.position,
				club: row.club || undefined,
				nation: row.nation || undefined,
				league: row.league || undefined,
				playstyles,
				playstylesPlus,
				pac: row.pac ?? undefined,
				sho: row.sho ?? undefined,
				pas: row.pas ?? undefined,
				dri: row.dri ?? undefined,
				def: row.def ?? undefined,
				phy: row.phy ?? undefined,
				div: row.div ?? undefined,
				han: row.han ?? undefined,
				kic: row.kic ?? undefined,
				ref: row.ref ?? undefined,
				spd: row.spd ?? undefined,
				pos: row.pos ?? undefined,
				skillMoves: row.skill_moves ?? undefined,
				weakFoot: row.weak_foot ?? undefined,
				workrateAttack: row.workrate_attack || undefined,
				workrateDefense: row.workrate_defense || undefined,
				url: row.url,
				overallRating: row.overall_rating ?? undefined,
				dateOfBirth: row.date_of_birth || undefined,
				height: row.height ?? undefined,
				weight: row.weight ?? undefined,
				foot: row.foot || undefined,
				age: row.age ?? undefined,
				rarity: row.rarity || undefined,
				accelerateType: row.accelerate_type || undefined,
				gender: row.gender || undefined,
				alternativePositions,
				acceleration: row.acceleration ?? undefined,
				sprintSpeed: row.sprint_speed ?? undefined,
				agility: row.agility ?? undefined,
				balance: row.balance ?? undefined,
				reactions: row.reactions ?? undefined,
				ballControl: row.ball_control ?? undefined,
				dribbling: row.dribbling ?? undefined,
				composure: row.composure ?? undefined,
				jumping: row.jumping ?? undefined,
				stamina: row.stamina ?? undefined,
				strength: row.strength ?? undefined,
				aggression: row.aggression ?? undefined,
				interceptions: row.interceptions ?? undefined,
				headingAccuracy: row.heading_accuracy ?? undefined,
				defensiveAwareness: row.defensive_awareness ?? undefined,
				standingTackle: row.standing_tackle ?? undefined,
				slidingTackle: row.sliding_tackle ?? undefined,
				vision: row.vision ?? undefined,
				crossing: row.crossing ?? undefined,
				fkAccuracy: row.fk_accuracy ?? undefined,
				shortPassing: row.short_passing ?? undefined,
				longPassing: row.long_passing ?? undefined,
				curve: row.curve ?? undefined,
				positioning: row.positioning ?? undefined,
				finishing: row.finishing ?? undefined,
				shotPower: row.shot_power ?? undefined,
				longShots: row.long_shots ?? undefined,
				volleys: row.volleys ?? undefined,
				penalties: row.penalties ?? undefined,
				gkDiving: row.gk_diving ?? undefined,
				gkHandling: row.gk_handling ?? undefined,
				gkKicking: row.gk_kicking ?? undefined,
				gkReflexes: row.gk_reflexes ?? undefined,
				gkPositioning: row.gk_positioning ?? undefined,
				gkSpeed: row.gk_speed ?? undefined,
				classifications: [] as string[],
			};

			mappedPlayer.classifications = classifyPlayer(mappedPlayer);
			return mappedPlayer;
		});
	}

	@Query(() => FutStatsSummary)
	async futStatsSummary(): Promise<FutStatsSummary> {
		const dbPath = join(
			import.meta.dir,
			"../data/fut_extracted_database.sqlite",
		);
		const db = new Database(dbPath);

		const totalPlayers = db
			.query("SELECT COUNT(*) as count FROM players")
			.get() as any;
		const totalPrices = db
			.query("SELECT COUNT(*) as count FROM prices")
			.get() as any;
		const avgOverall = db
			.query(
				"SELECT AVG(overall_rating) as avg FROM players WHERE overall_rating IS NOT NULL",
			)
			.get() as any;

		const positionCounts = db
			.query(
				"SELECT position, COUNT(*) as count FROM players GROUP BY position ORDER BY count DESC",
			)
			.all() as any[];
		const rarityCounts = db
			.query(
				"SELECT rarity, COUNT(*) as count FROM players WHERE rarity IS NOT NULL GROUP BY rarity ORDER BY count DESC LIMIT 10",
			)
			.all() as any[];
		const genderCounts = db
			.query(
				"SELECT gender, COUNT(*) as count FROM players WHERE gender IS NOT NULL GROUP BY gender",
			)
			.all() as any[];

		return {
			totalPlayersCrawled: totalPlayers?.count || 0,
			totalPricesTracked: totalPrices?.count || 0,
			averageOverallRating: Math.round((avgOverall?.avg || 0) * 10) / 10,
			positions: positionCounts.map((r) => ({
				name: r.position,
				count: r.count,
			})),
			rarities: rarityCounts.map((r) => ({
				name: r.rarity || "Unknown",
				count: r.count,
			})),
			genders: genderCounts.map((r) => ({
				name: r.gender || "Unknown",
				count: r.count,
			})),
		};
	}
}
