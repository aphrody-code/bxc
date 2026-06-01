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

import { z } from "zod";

export const FutPlayerSchema = z.object({
	name: z.string(),
	rating: z.number(),
	position: z.string(),
	club: z.string().optional(),
	nation: z.string().optional(),
	league: z.string().optional(),
	price: z.string().optional(),
	playstyles: z.array(z.string()),
	playstylesPlus: z.array(z.string()).optional(),
	pac: z.number().optional(),
	sho: z.number().optional(),
	pas: z.number().optional(),
	dri: z.number().optional(),
	def: z.number().optional(),
	phy: z.number().optional(),
	div: z.number().optional(),
	han: z.number().optional(),
	kic: z.number().optional(),
	ref: z.number().optional(),
	spd: z.number().optional(),
	pos: z.number().optional(),
	skillMoves: z.number().optional(),
	weakFoot: z.number().optional(),
	workrateAttack: z.string().optional(),
	workrateDefense: z.string().optional(),
	isGeneric: z.boolean().optional(),

	// Biology/card attributes
	overallRating: z.number().optional(),
	dateOfBirth: z.string().optional(),
	height: z.number().optional(),
	weight: z.number().optional(),
	foot: z.string().optional(),
	age: z.number().optional(),
	rarity: z.string().optional(),
	accelerateType: z.string().optional(),
	gender: z.string().optional(),
	alternativePositions: z.array(z.string()).optional(),

	// Detailed sub-stats
	acceleration: z.number().optional(),
	sprintSpeed: z.number().optional(),
	agility: z.number().optional(),
	balance: z.number().optional(),
	reactions: z.number().optional(),
	ballControl: z.number().optional(),
	dribbling: z.number().optional(),
	composure: z.number().optional(),
	jumping: z.number().optional(),
	stamina: z.number().optional(),
	strength: z.number().optional(),
	aggression: z.number().optional(),
	interceptions: z.number().optional(),
	headingAccuracy: z.number().optional(),
	defensiveAwareness: z.number().optional(),
	standingTackle: z.number().optional(),
	slidingTackle: z.number().optional(),
	vision: z.number().optional(),
	crossing: z.number().optional(),
	fkAccuracy: z.number().optional(),
	shortPassing: z.number().optional(),
	longPassing: z.number().optional(),
	curve: z.number().optional(),
	positioning: z.number().optional(),
	finishing: z.number().optional(),
	shotPower: z.number().optional(),
	longShots: z.number().optional(),
	volleys: z.number().optional(),
	penalties: z.number().optional(),
	gkDiving: z.number().optional(),
	gkHandling: z.number().optional(),
	gkKicking: z.number().optional(),
	gkReflexes: z.number().optional(),
	gkPositioning: z.number().optional(),
	gkSpeed: z.number().optional(),
});

export type FutPlayer = z.infer<typeof FutPlayerSchema>;

export const FutPriceSchema = z.object({
	url: z.string().url(),
	price: z.string(),
	lastUpdated: z.string(),
});

export type FutPrice = z.infer<typeof FutPriceSchema>;
