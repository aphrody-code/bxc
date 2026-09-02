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

import { describe, it, expect } from "bun:test";
import { parseSeasonEpisode, detectLanguage } from "./index.ts";

describe("IETV Episode Parsing", () => {
	it("parses Season X Episode Y format", () => {
		const result = parseSeasonEpisode("Season 1 Episode 5");
		expect(result.season).toBe(1);
		expect(result.episode).toBe(5);
	});

	it("parses S##E## format", () => {
		const result = parseSeasonEpisode("S01E05");
		expect(result.season).toBe(1);
		expect(result.episode).toBe(5);
	});

	it("parses French Saison/Épisode format", () => {
		const result = parseSeasonEpisode("Inazuma Eleven - Saison 1 Épisode 3");
		expect(result.season).toBe(1);
		expect(result.episode).toBe(3);
	});

	it("parses Ep. N format without inventing a season", () => {
		const result = parseSeasonEpisode("Inazuma Eleven Ep. 7");
		expect(result.season).toBeNull();
		expect(result.episode).toBe(7);
	});

	it("parses mixed case", () => {
		const result = parseSeasonEpisode("season 2 episode 10");
		expect(result.season).toBe(2);
		expect(result.episode).toBe(10);
	});

	it("returns null for unparseable titles", () => {
		const result = parseSeasonEpisode("Random Video Title");
		expect(result.season).toBeNull();
		expect(result.episode).toBeNull();
	});

	it("handles trailing numbers as episode when no season specified", () => {
		const result = parseSeasonEpisode("Inazuma Eleven 42");
		expect(result.season).toBeNull();
		expect(result.episode).toBe(42);
	});

	it("preserves season when only episode format changes", () => {
		const result = parseSeasonEpisode("Saison 3 - Episode 15");
		expect(result.season).toBe(3);
		expect(result.episode).toBe(15);
	});
});

describe("IETV Language Detection", () => {
	it("detects VF (Version Française)", () => {
		expect(detectLanguage("Inazuma Eleven - Saison 1 Episode 1 VF")).toBe("vf");
		expect(detectLanguage("Inazuma Eleven VF - Doublage Français")).toBe("vf");
		expect(detectLanguage("Saison 1 Episode 1 - Version Française")).toBe("vf");
	});

	it("detects VOSTFR (Version Originale Sous-Titrée Française)", () => {
		expect(detectLanguage("Inazuma Eleven - Saison 1 Episode 1 VOSTFR")).toBe("vostfr");
		expect(detectLanguage("Inazuma Eleven VOSTFR - Japanese Original")).toBe("vostfr");
		expect(detectLanguage("Episode 1 V.O.STFR - Japonais Sous-Titré")).toBe("vostfr");
		expect(detectLanguage("Inazuma Eleven JP French Subtitles")).toBe("vostfr");
	});

	it("defaults to VF when no explicit marker", () => {
		expect(detectLanguage("Inazuma Eleven - Saison 1 Episode 1")).toBe("vf");
		expect(detectLanguage("Saison 2 Episode 5")).toBe("vf");
	});

	it("marks as unknown without language clue", () => {
		expect(detectLanguage("Random Video Title 123")).toBe("unknown");
		expect(detectLanguage("Video 456")).toBe("unknown");
	});

	it("prioritizes VOSTFR over VF when both present", () => {
		// If both markers are present, VOSTFR takes precedence
		expect(detectLanguage("Inazuma Eleven VOSTFR VF")).toBe("vostfr");
	});
});
