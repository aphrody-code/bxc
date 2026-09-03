// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
	expiryFromUrl,
	hostFromUrl,
	hostTraits,
	normalizeEmbedUrl,
	playbackHeaders,
} from "../../src/media/hosts.ts";

describe("registre des hébergeurs", () => {
	test("reconnaît les hébergeurs réellement rencontrés", () => {
		expect(hostFromUrl("https://ansembed.net/embed-a.html")).toBe("ansembed");
		expect(hostFromUrl("https://lpayer.embed4me.com/e/abc")).toBe("embed4me");
		expect(hostFromUrl("https://video.sibnet.ru/shell.php?videoid=1")).toBe("sibnet");
		expect(hostFromUrl("https://vidmoly.to/embed-x.html")).toBe("vidmoly");
		expect(hostFromUrl("https://oneupload.to/embed-x.html")).toBe("oneupload");
		expect(hostFromUrl("https://movearnpre.com/embed/x")).toBe("movearnpre");
		expect(hostFromUrl("https://s22.anime-sama.fr/f/x.mp4")).toBe("anime-sama");
	});

	test("garde le nom d'hôte quand l'hébergeur est inconnu", () => {
		expect(hostFromUrl("https://www.nouveau-lecteur.test/e/1")).toBe("nouveau-lecteur.test");
		expect(hostFromUrl("pas une url")).toBe("unknown");
	});

	test("signale les lecteurs propriétaires et les pages obfusquées", () => {
		expect(hostTraits("https://www.youtube.com/embed/x").proprietary).toBe(true);
		expect(hostTraits("https://www.dailymotion.com/embed/video/x").proprietary).toBe(true);
		expect(hostTraits("https://voe.sx/e/x").obfuscated).toBe(true);
		expect(hostTraits("https://ansembed.net/e/x").proprietary).toBeUndefined();
	});

	test("réécrit les domaines vidmoly morts", () => {
		expect(normalizeEmbedUrl("https://vidmoly.to/embed-x.html")).toBe(
			"https://vidmoly.biz/embed-x.html",
		);
		expect(normalizeEmbedUrl(" https://vidmoly.net/embed-x.html ")).toBe(
			"https://vidmoly.biz/embed-x.html",
		);
		expect(normalizeEmbedUrl("https://sibnet.ru/x")).toBe("https://sibnet.ru/x");
	});
});

describe("en-têtes de lecture", () => {
	test("rejoue le Referer et l'Origin de l'hébergeur", () => {
		const headers = playbackHeaders("https://ansembed.net/embed-a.html", "bxc/1.0");
		expect(headers).toEqual({
			"User-Agent": "bxc/1.0",
			Referer: "https://ansembed.net/",
			Origin: "https://ansembed.net",
		});
	});

	test("n'invente pas d'en-tête sur une URL inexploitable", () => {
		expect(playbackHeaders("pas une url")).toEqual({});
	});
});

describe("expiration des liens signés", () => {
	test("lit une échéance en secondes ou en millisecondes", () => {
		expect(expiryFromUrl("https://c.test/a.m3u8?e=1788000000")).toBe(1_788_000_000_000);
		expect(expiryFromUrl("https://c.test/a.m3u8?expires=1788000000000")).toBe(1_788_000_000_000);
		expect(expiryFromUrl("https://c.test/a.m3u8?t=1788000000&h=abc")).toBe(1_788_000_000_000);
	});

	test("ignore ce qui ne ressemble pas à une échéance", () => {
		expect(expiryFromUrl("https://c.test/a.m3u8")).toBeNull();
		expect(expiryFromUrl("https://c.test/a.m3u8?t=42")).toBeNull();
		// Un identifiant de vidéo n'est pas une date, même s'il en a la longueur.
		expect(expiryFromUrl("https://c.test/a.m3u8?e=999999999")).toBeNull();
		expect(expiryFromUrl("pas une url")).toBeNull();
	});
});
