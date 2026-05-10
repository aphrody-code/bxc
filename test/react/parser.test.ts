/**
 * Tests for the bunlight React/Next.js hydration parsers.
 */

import { describe, expect, test } from "bun:test";

import {
	parseNextData,
	parseAppRouterFlight,
	parseNuxtState,
	parseRemixContext,
	parseInitialState,
	parseAstroIslands,
	findReactRoots,
	detectHydration,
} from "../../src/react/parser.ts";

describe("parseNextData", () => {
	test("extracts JSON payload", () => {
		const html = `
<html><body>
<div id="__next"><h1>hi</h1></div>
<script id="__NEXT_DATA__" type="application/json">
{"props":{"pageProps":{"user":"alice"}},"page":"/users/[id]","query":{"id":"42"},"buildId":"abc123","isFallback":false}
</script>
</body></html>`;
		const data = parseNextData(html);
		expect(data).not.toBeNull();
		expect(data?.page).toBe("/users/[id]");
		expect(data?.buildId).toBe("abc123");
		expect(data?.props?.pageProps).toEqual({ user: "alice" });
	});

	test("returns null when missing", () => {
		expect(parseNextData("<html><body>nothing</body></html>")).toBeNull();
	});

	test("returns null when payload is not valid JSON", () => {
		const html = `<script id="__NEXT_DATA__">not-json</script>`;
		expect(parseNextData(html)).toBeNull();
	});
});

describe("parseAppRouterFlight", () => {
	test("extracts flight chunks", () => {
		const html = `
<script>self.__next_f=self.__next_f||[]</script>
<script>self.__next_f.push([1,"hello"])</script>
<script>self.__next_f.push([2,"world"])</script>
<script>self.__next_f.push([3,null])</script>
`;
		const chunks = parseAppRouterFlight(html);
		expect(chunks).toHaveLength(3);
		expect(chunks[0]).toEqual({ index: 1, payload: "hello" });
		expect(chunks[1]).toEqual({ index: 2, payload: "world" });
		expect(chunks[2]).toEqual({ index: 3, payload: "" });
	});
});

describe("parseNuxtState", () => {
	test("extracts JSON __NUXT__ payload", () => {
		const html = `<script>window.__NUXT__={"data":{"page":"home"}}</script>`;
		const out = parseNuxtState(html);
		expect(out).toEqual({ data: { page: "home" } });
	});
});

describe("parseRemixContext", () => {
	test("extracts JSON __remixContext payload", () => {
		const html = `<script>window.__remixContext={"loaderData":{"x":1}}</script>`;
		expect(parseRemixContext(html)).toEqual({ loaderData: { x: 1 } });
	});
});

describe("parseInitialState", () => {
	test("falls back across __INITIAL_STATE__ / __PRELOADED_STATE__ / __APOLLO_STATE__", () => {
		expect(parseInitialState(`<script>window.__APOLLO_STATE__={"q":1}</script>`)).toEqual({ q: 1 });
		expect(parseInitialState(`<script>window.__PRELOADED_STATE__={"y":2}</script>`)).toEqual({
			y: 2,
		});
		expect(parseInitialState(`<script>window.__INITIAL_STATE__={"z":3}</script>`)).toEqual({
			z: 3,
		});
		expect(parseInitialState("<html></html>")).toBeNull();
	});
});

describe("parseAstroIslands", () => {
	test("returns attribute maps for each <astro-island>", () => {
		const html = `
<astro-island uid="abc" component-export="default" props='{"foo":"bar"}'>
  <button>x</button>
</astro-island>
<astro-island uid="def">no-attrs</astro-island>
`;
		const islands = parseAstroIslands(html);
		expect(islands).toHaveLength(2);
		expect(islands[0].uid).toBe("abc");
		expect(islands[0]["component-export"]).toBe("default");
		expect(islands[1].uid).toBe("def");
	});
});

describe("findReactRoots", () => {
	test("identifies #__next + markers", () => {
		const html = `<div id="__next" data-reactroot=""><span data-react-class="App">hi</span></div>`;
		const roots = findReactRoots(html);
		expect(roots).toHaveLength(1);
		expect(roots[0].selector).toBe("#__next");
		expect(roots[0].markers).toContain("data-react-class");
	});
});

describe("detectHydration", () => {
	test("classifies Next Pages", () => {
		const html = `<script id="__NEXT_DATA__">{"props":{"pageProps":{}},"page":"/","query":{},"buildId":"x"}</script>`;
		const sig = detectHydration(html);
		expect(sig.framework).toBe("next-pages");
		expect(sig.hydrated).toBe(true);
	});

	test("classifies Next App Router", () => {
		const html = `<script>self.__next_f.push([1,"foo"])</script>`;
		const sig = detectHydration(html);
		expect(sig.framework).toBe("next-app");
	});

	test("classifies React generic", () => {
		const html = `<div id="root" data-reactroot=""></div>`;
		const sig = detectHydration(html);
		expect(sig.framework).toBe("react");
	});

	test("returns unknown when no markers", () => {
		const html = `<html><body><h1>plain</h1></body></html>`;
		const sig = detectHydration(html);
		expect(sig.framework).toBe("unknown");
		expect(sig.hydrated).toBe(false);
	});
});
