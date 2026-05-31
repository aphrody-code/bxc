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

export interface FutPlayer {
	name: string;
	rating: number;
	position: string;
	club?: string;
	nation?: string;
	league?: string;
	price?: string;
	playstyles: string[];
	playstylesPlus?: string[];
	pac?: number;
	sho?: number;
	pas?: number;
	dri?: number;
	def?: number;
	phy?: number;
	div?: number;
	han?: number;
	kic?: number;
	ref?: number;
	spd?: number;
	pos?: number;
	skillMoves?: number;
	weakFoot?: number;
	workrateAttack?: string;
	workrateDefense?: string;
	isGeneric?: boolean;
}

export interface FutPrice {
	url: string;
	price: string;
	lastUpdated: string;
}
