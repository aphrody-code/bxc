// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
	classifyMedia,
	extractMediaCandidates,
	extractPoster,
} from "../../src/media/extract.ts";

const BASE = "https://ansembed.net/embed-abc.html";

describe("classification d'une URL", () => {
	test("reconnaît les conteneurs courants, requête comprise", () => {
		expect(classifyMedia("https://c.test/master.m3u8?t=1")).toBe("hls");
		expect(classifyMedia("https://c.test/v.mpd")).toBe("dash");
		expect(classifyMedia("https://c.test/v.mp4#t=3")).toBe("mp4");
		expect(classifyMedia("https://c.test/embed-x.html")).toBe("unknown");
	});
});

describe("extraction des pistes", () => {
	test("lit tout le tableau de sources d'un lecteur, avec les libellés", () => {
		const page = `jwplayer("p").setup({sources:[{file:"https://c.test/720.mp4",label:"720p"},{file:"https://c.test/480.mp4",label:"480p"}]});`;
		const found = extractMediaCandidates(page, BASE);
		expect(found.map((c) => [c.label, c.url])).toEqual([
			["720p", "https://c.test/720.mp4"],
			["480p", "https://c.test/480.mp4"],
		]);
		expect(found.every((c) => c.rule === "jwplayer.sources")).toBe(true);
	});

	test("classe la source déclarée devant une URL glanée dans la page", () => {
		const page = `<a href="https://pub.test/pub.mp4">pub</a><script>setup({sources:[{file:"https://c.test/vrai.m3u8"}]})</script>`;
		const [best, ...rest] = extractMediaCandidates(page, BASE);
		expect(best.url).toBe("https://c.test/vrai.m3u8");
		expect(best.confidence).toBeGreaterThan(rest[0].confidence);
		expect(rest[0].rule).toBe("bare.url");
	});

	test("rend le chemin relatif de sibnet en URL absolue", () => {
		const page = `<script>player.src([{src: "/v/11ac91/4826196.mp4"}]);</script>`;
		const [best] = extractMediaCandidates(page, "https://video.sibnet.ru/shell.php?videoid=4826196");
		expect(best.url).toBe("https://video.sibnet.ru/v/11ac91/4826196.mp4");
		expect(best.kind).toBe("mp4");
	});

	test("défait les échappements JavaScript et les entités HTML", () => {
		const page = `var f = "https:\\/\\/c.test\\/a.m3u8?token=1&amp;h=2";`;
		const [best] = extractMediaCandidates(page, BASE);
		expect(best.url).toBe("https://c.test/a.m3u8?token=1&h=2");
	});

	test("trouve la piste sous un script compressé et note la profondeur", () => {
		const packed = `eval(function(p,a,c,k,e,d){while(c--)if(k[c])p=p.replace(new RegExp("\\\\b"+c.toString(a)+"\\\\b","g"),k[c]);return p}('0.1({2:[{3:"4"}]})',5,5,'jwplayer|setup|sources|file|https://c.test/packed.m3u8'.split('|')))`;
		const [best] = extractMediaCandidates(packed, BASE);
		expect(best.url).toBe("https://c.test/packed.m3u8");
		expect(best.layer).toBe(1);
		expect(best.rule).toBe("jwplayer.sources");
	});

	test("une même URL n'apparaît qu'une fois, avec sa meilleure provenance", () => {
		const page = `<source src="https://c.test/a.mp4"><script>setup({sources:[{file:"https://c.test/a.mp4"}]})</script>`;
		const found = extractMediaCandidates(page, BASE);
		expect(found).toHaveLength(1);
		expect(found[0].rule).toBe("jwplayer.sources");
	});

	test("dit où la piste a été trouvée dans la source", () => {
		const page = `<!-- entête -->\n<script>var file = "https://c.test/a.m3u8";</script>`;
		const [best] = extractMediaCandidates(page, BASE);
		expect(best.offset).toBe(page.indexOf('file = "'));
		expect(best.layer).toBe(0);
	});

	test("rend une liste vide plutôt qu'une URL inventée", () => {
		expect(extractMediaCandidates("<html>rien du tout</html>", BASE)).toEqual([]);
	});

	test("lit l'aperçu déclaré par le lecteur ou la page", () => {
		expect(extractPoster(`setup({image:"https://c.test/p.jpg"})`, BASE)).toBe(
			"https://c.test/p.jpg",
		);
		expect(
			extractPoster(`<meta property="og:image" content="/vignette.png">`, BASE),
		).toBe("https://ansembed.net/vignette.png");
		expect(extractPoster("<html></html>", BASE)).toBeNull();
	});
});
