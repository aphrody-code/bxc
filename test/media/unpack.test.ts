// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
	decodeBase64Payloads,
	isPacked,
	peelLayers,
	unescapeUrls,
	unpackPacker,
} from "../../src/media/unpack.ts";

/** Construit une charge compressée à la Dean Edwards, comme les hébergeurs. */
function pack(payload: string, words: string[], quote = "'"): string {
	const q = quote;
	return `eval(function(p,a,c,k,e,d){while(c--)if(k[c])p=p.replace(new RegExp(String.fromCharCode(92)+"b"+c.toString(a)+String.fromCharCode(92)+"b","g"),k[c]);return p}(${q}${payload}${q},${words.length},${words.length},${q}${words.join("|")}${q}.split(${q}|${q})))`;
}

describe("déballage d'un script compressé", () => {
	test("restitue la charge utile", () => {
		const packed = pack('0.1({2:"3"})', ["jwplayer", "setup", "file", "https://c.test/a.m3u8"]);
		expect(isPacked(packed)).toBe(true);
		expect(unpackPacker(packed)).toBe('jwplayer.setup({file:"https://c.test/a.m3u8"})');
	});

	test("accepte aussi les guillemets doubles", () => {
		const packed = pack('0({1:"2"})', ["setup", "file", "https://c.test/b.mp4"], '"');
		expect(unpackPacker(packed)).toBe('setup({file:"https://c.test/b.mp4"})');
	});

	test("rend la source inchangée quand elle n'est pas compressée", () => {
		expect(isPacked("<html>rien</html>")).toBe(false);
		expect(unpackPacker("<html>rien</html>")).toBe("<html>rien</html>");
	});

	test("ne se laisse pas piéger par une base absurde", () => {
		const bogus = "}('0',0,1,'a'.split('|'))";
		expect(unpackPacker(bogus)).toBe(bogus);
	});
});

describe("charges base64", () => {
	test("décode ce qui est assez long pour porter une URL", () => {
		const payload = Buffer.from("https://c.test/playlist.m3u8").toString("base64");
		expect(decodeBase64Payloads(`atob("${payload}")`)).toEqual([
			"https://c.test/playlist.m3u8",
		]);
	});

	test("ignore une chaîne qui ne donne pas du texte", () => {
		const binary = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 200, 201, 202, 203, 204, 205, 206]).toString("base64");
		expect(decodeBase64Payloads(`atob("${binary}${binary}")`)).toEqual([]);
	});
});

describe("épluchage en couches", () => {
	test("rend la source brute puis chaque déballage", () => {
		const packed = pack('0("1")', ["play", "https://c.test/a.m3u8"]);
		const layers = peelLayers(packed);
		expect(layers[0]).toMatchObject({ depth: 0, via: "raw" });
		expect(layers[1]).toMatchObject({ depth: 1, via: "packer" });
		expect(layers[1].text).toContain("https://c.test/a.m3u8");
	});

	test("ajoute les charges base64 rencontrées, une couche plus bas", () => {
		const payload = Buffer.from("https://c.test/x.m3u8").toString("base64");
		const layers = peelLayers(`<script>var u = atob("${payload}");</script>`);
		expect(layers.map((l) => l.via)).toEqual(["raw", "base64"]);
		expect(layers[1].depth).toBe(1);
	});

	test("une source déjà déballée ne produit qu'une couche", () => {
		expect(peelLayers("<html>rien</html>")).toHaveLength(1);
	});
});

describe("échappements", () => {
	test("rétablit les URL masquées par le JavaScript", () => {
		expect(unescapeUrls("https:\\/\\/c.test\\/a.m3u8")).toBe("https://c.test/a.m3u8");
		expect(unescapeUrls("https\\u003A\\u002Fc.test")).toBe("https:/c.test");
	});
});
