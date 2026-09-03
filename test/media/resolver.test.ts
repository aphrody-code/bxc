// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { resolveEmbed, resolveVariants } from "../../src/media/resolver.ts";
import type { MediaRequest, MediaTransport } from "../../src/media/types.ts";

/** Transport factice : sert des pages littérales et journalise les requêtes. */
function transport(pages: Record<string, string>): {
	fn: MediaTransport;
	calls: MediaRequest[];
} {
	const calls: MediaRequest[] = [];
	const fn: MediaTransport = async (request) => {
		calls.push(request);
		const body = pages[request.url];
		return body === undefined
			? { status: 404, body: "", url: request.url }
			: { status: 200, body, url: request.url };
	};
	return { fn, calls };
}

const MASTER = [
	"#EXTM3U",
	"#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1280x720",
	"720/index.m3u8",
	"#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360",
	"360/index.m3u8",
].join("\n");

describe("résolution d'un embed", () => {
	test("extrait la piste, ses en-têtes de lecture et son échéance", async () => {
		const { fn } = transport({
			"https://ansembed.net/e/abc": `<script>setup({image:"https://c.test/p.jpg",sources:[{file:"https://c.test/master.m3u8?e=1788000000",label:"auto"}]})</script>`,
		});
		const media = await resolveEmbed("https://ansembed.net/e/abc", { transport: fn });
		expect(media).toMatchObject({
			host: "ansembed",
			kind: "hls",
			url: "https://c.test/master.m3u8?e=1788000000",
			poster: "https://c.test/p.jpg",
			expiresAt: 1_788_000_000_000,
		});
		expect(media.headers.Referer).toBe("https://ansembed.net/");
		expect(media.candidates[0].rule).toBe("jwplayer.sources");
		expect(media.error).toBeUndefined();
	});

	test("suit l'iframe interne et retient l'hébergeur réel", async () => {
		const { fn, calls } = transport({
			"https://site.test/embed": `<iframe src="https://video.sibnet.ru/shell.php?videoid=42"></iframe>`,
			"https://video.sibnet.ru/shell.php?videoid=42": `<script>player.src([{src:"/v/ab12/42.mp4"}])</script>`,
		});
		const media = await resolveEmbed("https://site.test/embed", { transport: fn });
		expect(calls).toHaveLength(2);
		expect(media.host).toBe("sibnet");
		expect(media.url).toBe("https://video.sibnet.ru/v/ab12/42.mp4");
		expect(media.headers.Referer).toBe("https://video.sibnet.ru/");
	});

	test("ne suit pas l'iframe au-delà du nombre de sauts autorisé", async () => {
		const { fn, calls } = transport({
			"https://a.test/1": `<iframe src="https://b.test/2"></iframe>`,
			"https://b.test/2": `<iframe src="https://c.test/3"></iframe>`,
			"https://c.test/3": `<script>setup({sources:[{file:"https://c.test/v.mp4"}]})</script>`,
		});
		const media = await resolveEmbed("https://a.test/1", { transport: fn, maxHops: 1 });
		expect(calls.map((c) => c.url)).toEqual(["https://a.test/1", "https://b.test/2"]);
		expect(media.url).toBeNull();
		expect(media.error).toMatch(/aucune piste/);
	});

	test("normalise l'URL d'embed avant d'aller frapper", async () => {
		const { fn, calls } = transport({
			"https://vidmoly.biz/embed-x.html": `<script>setup({sources:[{file:"https://c.test/v.mp4"}]})</script>`,
		});
		const media = await resolveEmbed("https://vidmoly.to/embed-x.html", { transport: fn });
		expect(calls[0].url).toBe("https://vidmoly.biz/embed-x.html");
		expect(media.url).toBe("https://c.test/v.mp4");
	});

	test("énumère les qualités d'un master HLS quand on le demande", async () => {
		const { fn, calls } = transport({
			"https://x.test/e": `<script>setup({sources:[{file:"https://c.test/master.m3u8"}]})</script>`,
			"https://c.test/master.m3u8": MASTER,
		});
		const media = await resolveEmbed("https://x.test/e", {
			transport: fn,
			enumerateVariants: true,
		});
		expect(media.variants.map((v) => v.label)).toEqual(["720p", "360p"]);
		expect(media.variants[0].url).toBe("https://c.test/720/index.m3u8");
		expect(calls).toHaveLength(2);
	});

	test("l'échec de l'énumération ne perd pas l'URL déjà résolue", async () => {
		const { fn } = transport({
			"https://x.test/e": `<script>setup({sources:[{file:"https://c.test/master.m3u8"}]})</script>`,
			// le master répond 404 : rien à énumérer
		});
		const media = await resolveEmbed("https://x.test/e", {
			transport: fn,
			enumerateVariants: true,
		});
		expect(media.url).toBe("https://c.test/master.m3u8");
		expect(media.variants).toEqual([]);
	});
});

describe("échecs décrits plutôt que levés", () => {
	test("un lecteur propriétaire est écarté sans requête", async () => {
		const { fn, calls } = transport({});
		const media = await resolveEmbed("https://www.youtube.com/embed/x", { transport: fn });
		expect(calls).toEqual([]);
		expect(media.host).toBe("youtube");
		expect(media.error).toMatch(/propriétaire/);
		expect(media.url).toBeNull();
	});

	test("un code HTTP d'erreur est rapporté tel quel", async () => {
		const { fn } = transport({});
		const media = await resolveEmbed("https://ansembed.net/e/absent", { transport: fn });
		expect(media.error).toBe("le lecteur répond 404");
	});

	test("une page obfusquée dit ce qu'il faudrait faire", async () => {
		const { fn } = transport({ "https://voe.sx/e/x": "<html>ø</html>" });
		const media = await resolveEmbed("https://voe.sx/e/x", { transport: fn });
		expect(media.error).toMatch(/exécuter la page/);
	});

	test("un transport qui lève est converti en erreur lisible", async () => {
		const media = await resolveEmbed("https://ansembed.net/e/x", {
			transport: async () => {
				throw new Error("socket morte");
			},
		});
		expect(media.error).toMatch(/injoignable.*socket morte/);
		expect(media.url).toBeNull();
	});
});

describe("énumération isolée", () => {
	test("rend les variantes d'une playlist maîtresse", async () => {
		const { fn } = transport({ "https://c.test/m.m3u8": MASTER });
		const variants = await resolveVariants("https://c.test/m.m3u8", { transport: fn });
		expect(variants).toHaveLength(2);
	});

	test("une playlist de segments n'a pas de variante à proposer", async () => {
		const { fn } = transport({ "https://c.test/720.m3u8": "#EXTM3U\n#EXTINF:10,\na.ts" });
		expect(await resolveVariants("https://c.test/720.m3u8", { transport: fn })).toEqual([]);
	});
});
