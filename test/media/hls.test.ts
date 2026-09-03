// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
	isMasterPlaylist,
	isPlaylist,
	labelFromHeight,
	parseMasterPlaylist,
	playlistDuration,
} from "../../src/media/hls.ts";

const MASTER = [
	"#EXTM3U",
	'#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.42c01e,mp4a.40.2"',
	"360/index.m3u8",
	'#EXT-X-STREAM-INF:BANDWIDTH=2400000,AVERAGE-BANDWIDTH=2100000,RESOLUTION=1280x720,FRAME-RATE=23.976,NAME="HD"',
	"https://autre.test/720/index.m3u8",
	"",
].join("\n");

describe("playlists HLS", () => {
	test("distingue une playlist d'une page HTML", () => {
		expect(isPlaylist(MASTER)).toBe(true);
		expect(isPlaylist("<html></html>")).toBe(false);
		expect(isMasterPlaylist(MASTER)).toBe(true);
		expect(isMasterPlaylist("#EXTM3U\n#EXTINF:10,\na.ts")).toBe(false);
	});

	test("classe les variantes de la plus définie à la moins définie", () => {
		const variants = parseMasterPlaylist(MASTER, "https://cdn.test/hls/master.m3u8?t=1");
		expect(variants.map((v) => v.label)).toEqual(["720p", "360p"]);
	});

	test("résout les URI relatives contre la playlist et garde les absolues", () => {
		const [hd, sd] = parseMasterPlaylist(MASTER, "https://cdn.test/hls/master.m3u8?t=1");
		expect(hd.url).toBe("https://autre.test/720/index.m3u8");
		expect(sd.url).toBe("https://cdn.test/hls/360/index.m3u8");
	});

	test("lit les attributs, y compris une liste de codecs entre guillemets", () => {
		const [hd, sd] = parseMasterPlaylist(MASTER, "https://cdn.test/hls/master.m3u8");
		expect(hd).toMatchObject({
			bandwidth: 2_400_000,
			averageBandwidth: 2_100_000,
			width: 1280,
			height: 720,
			frameRate: 23.976,
			name: "HD",
		});
		expect(sd.codecs).toBe("avc1.42c01e,mp4a.40.2");
		expect(sd.name).toBeNull();
	});

	test("saute les commentaires entre la déclaration et son URI", () => {
		const withComment = [
			"#EXTM3U",
			"#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=426x240",
			"# une remarque du serveur",
			"",
			"240/index.m3u8",
		].join("\n");
		const [only] = parseMasterPlaylist(withComment, "https://cdn.test/m.m3u8");
		expect(only.url).toBe("https://cdn.test/240/index.m3u8");
	});

	test("une déclaration sans URI est ignorée plutôt que rendue à moitié", () => {
		const truncated = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000\n";
		expect(parseMasterPlaylist(truncated, "https://cdn.test/m.m3u8")).toEqual([]);
	});

	test("distingue deux variantes de même définition par leur débit", () => {
		const twins = [
			"#EXTM3U",
			"#EXT-X-STREAM-INF:BANDWIDTH=1282079,RESOLUTION=720x416",
			"n/index.m3u8",
			"#EXT-X-STREAM-INF:BANDWIDTH=819894,RESOLUTION=720x416",
			"l/index.m3u8",
			"#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=640x360",
			"s/index.m3u8",
		].join("\n");
		expect(parseMasterPlaylist(twins, "https://cdn.test/m.m3u8").map((v) => v.label)).toEqual([
			"416p (1282 kbps)",
			"416p (820 kbps)",
			"360p",
		]);
	});

	test("additionne la durée d'une playlist de segments", () => {
		expect(playlistDuration("#EXTM3U\n#EXTINF:10.5,\na.ts\n#EXTINF:9.5,\nb.ts")).toBe(20);
		expect(playlistDuration(MASTER)).toBeNull();
	});

	test("nomme une variante par sa hauteur", () => {
		expect(labelFromHeight(1080)).toBe("1080p");
		expect(labelFromHeight(null)).toBeNull();
	});
});
