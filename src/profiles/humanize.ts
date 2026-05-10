/**
 * @module bunlight/profiles/humanize
 *
 * Human-like interaction helpers: Bezier mouse paths, natural typing delays,
 * scroll jitter. Used by both stealth and max profiles.
 *
 * Inspired by botasaurus + Scrapling patterns (2026 anti-bot research).
 */

import type { Page } from "patchright";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HumanizeOptions {
	mouse?: boolean | "bezier";
	scroll?: boolean | "human";
	typing?: boolean | "natural";
}

// ---------------------------------------------------------------------------
// Bezier curve mouse movement
// ---------------------------------------------------------------------------

/** A 2D point. */
interface Point {
	x: number;
	y: number;
}

/**
 * Computes points along a cubic Bezier curve.
 * Used to generate a natural mouse path from source to destination.
 */
function bezierPoints(p0: Point, p1: Point, p2: Point, p3: Point, steps: number): Point[] {
	const pts: Point[] = [];
	for (let i = 0; i <= steps; i++) {
		const t = i / steps;
		const mt = 1 - t;
		pts.push({
			x: mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x,
			y: mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y,
		});
	}
	return pts;
}

/**
 * Moves the mouse from (fromX, fromY) to (toX, toY) using a Bezier curve
 * with random control points to simulate human trajectory.
 */
export async function moveMouse(page: Page, toX: number, toY: number): Promise<void> {
	// Random control points offset from the midpoint
	const midX = toX / 2;
	const midY = toY / 2;
	const jitter = () => (Math.random() - 0.5) * 150;

	const p0: Point = { x: 0, y: 0 };
	const p1: Point = { x: midX + jitter(), y: midY + jitter() };
	const p2: Point = { x: midX + jitter(), y: midY + jitter() };
	const p3: Point = { x: toX, y: toY };

	const steps = 20 + Math.floor(Math.random() * 10);
	const points = bezierPoints(p0, p1, p2, p3, steps);

	for (const pt of points) {
		await page.mouse.move(pt.x, pt.y);
		// Small delay variance between 5-15ms
		await sleep(5 + Math.random() * 10);
	}
}

// ---------------------------------------------------------------------------
// Natural typing
// ---------------------------------------------------------------------------

/** Characters that typically cause longer pauses (shift key, etc.). */
const SLOW_CHARS = new Set([" ", ".", ",", "!", "?", "@", "#", "$", "%", "^", "&", "*"]);

/**
 * Types text with natural inter-keystroke delays and occasional "think" pauses.
 */
export async function typeNatural(page: Page, selector: string, text: string): Promise<void> {
	await page.click(selector);
	await sleep(randomDelay(200, 500));

	for (const char of text) {
		await page.type(selector, char);
		const base = SLOW_CHARS.has(char) ? randomDelay(80, 180) : randomDelay(40, 120);
		// Occasional longer pause (0.5% chance) simulating "thinking"
		const pause = Math.random() < 0.005 ? randomDelay(400, 1200) : base;
		await sleep(pause);
	}
}

// ---------------------------------------------------------------------------
// Human-like scroll
// ---------------------------------------------------------------------------

/**
 * Scrolls the page by `pixels` with random jitter and acceleration simulation.
 */
export async function scrollHuman(page: Page, pixels: number): Promise<void> {
	const steps = 8 + Math.floor(Math.random() * 6);
	const stepSize = pixels / steps;

	for (let i = 0; i < steps; i++) {
		const jitter = (Math.random() - 0.5) * 20;
		await page.evaluate((delta: number) => window.scrollBy(0, delta), stepSize + jitter);
		await sleep(randomDelay(20, 60));
	}
}

// ---------------------------------------------------------------------------
// Google referrer injection
// ---------------------------------------------------------------------------

/**
 * Injects a Google search referer header for the navigation.
 * Many bot-detection systems check that social/organic traffic arrives from
 * a plausible referrer.
 */
export function makeGoogleReferer(targetUrl: string): string {
	const query = encodeURIComponent(new URL(targetUrl).hostname);
	return `https://www.google.com/search?q=${query}`;
}

// ---------------------------------------------------------------------------
// Cookie jar helpers
// ---------------------------------------------------------------------------

export interface SerializedCookie {
	name: string;
	value: string;
	domain: string;
	path: string;
	expires: number;
	httpOnly: boolean;
	secure: boolean;
	sameSite: "Strict" | "Lax" | "None";
}

/**
 * Loads cookies from a JSON file into the page context.
 * Silently ignores missing files (first-run scenario).
 */
export async function loadCookies(page: Page, cookieJarPath: string): Promise<SerializedCookie[]> {
	try {
		const file = Bun.file(cookieJarPath);
		if (!(await file.exists())) return [];
		const raw = (await file.json()) as SerializedCookie[];
		await page.context().addCookies(raw);
		return raw;
	} catch {
		return [];
	}
}

/**
 * Saves current page cookies to a JSON file for future reuse.
 * This enables `cf_clearance` token reuse, saving 80% of challenge rounds.
 */
export async function saveCookies(page: Page, cookieJarPath: string): Promise<void> {
	try {
		const cookies = await page.context().cookies();
		await Bun.write(cookieJarPath, JSON.stringify(cookies, null, 2));
	} catch {
		// best-effort
	}
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Bun-native sleep wrapper kept as a local alias for readability. */
const sleep = (ms: number): Promise<void> => Bun.sleep(ms);

function randomDelay(min: number, max: number): number {
	return min + Math.random() * (max - min);
}

/** Waits a random delay in [minMs, maxMs]. Useful for pacing between actions. */
export function randomWait(minMs = 800, maxMs = 1200): Promise<void> {
	return sleep(randomDelay(minMs, maxMs));
}
