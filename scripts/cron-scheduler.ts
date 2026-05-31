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

/**
 * Bxc Cron Scheduler
 * Allows scheduling periodic scraping tasks directly from Bun.
 */

import { Browser } from "../src/api/browser";
import { BxcDB } from "../src/db/BxcDB";

const db = new BxcDB();

interface Task {
	name: string;
	url: string;
	profile: string;
	intervalMs: number;
}

const tasks: Task[] = [
	{
		name: "HackerNews Top",
		url: "https://news.ycombinator.com",
		profile: "static",
		intervalMs: 3600_000, // Every hour
	},
	{
		name: "Gemini Home Check",
		url: "https://gemini.google.com",
		profile: "stealth",
		intervalMs: 600_000, // Every 10 mins
	},
];

async function runTask(task: Task) {
	console.log(`[Cron] Running task: ${task.name}...`);
	const page = await Browser.newPage({ profile: task.profile as any });
	try {
		const res = await page.goto(task.url);
		const title = await page.title();
		console.log(`[Cron] ${task.name} success: ${title} (${res.status})`);

		db.saveScrape(task.url, task.profile, res.status, await page.content(), {
			taskName: task.name,
			title,
		});
	} catch (err) {
		console.error(`[Cron] ${task.name} failed:`, err);
	} finally {
		await page.close();
	}
}

// Start all tasks using Bun's native cron engine
for (const task of tasks) {
	console.log(
		`[Cron] Scheduling task: ${task.name} (${task.intervalMs}ms interval)...`,
	);

	// Bun.cron expects a cron expression. Since we have intervalMs,
	// we convert simple intervals to cron strings or stay with setInterval
	// if they are sub-minute. For hours/minutes, cron is better.

	if (task.intervalMs >= 60_000) {
		const minutes = Math.floor(task.intervalMs / 60_000);
		const expression = `*/${minutes} * * * *`;

		Bun.cron(expression, () => runTask(task));
	} else {
		// Fallback for high-frequency sub-minute tasks
		setInterval(() => runTask(task), task.intervalMs);
	}
}

console.log("⚡️ Bxc Scheduler started.");
