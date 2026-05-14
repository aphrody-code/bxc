/**
 * Bunlight Cron Scheduler
 * Allows scheduling periodic scraping tasks directly from Bun.
 */

import { Browser } from "../src/api/browser";
import { BunlightDB } from "../src/db/BunlightDB";

const db = new BunlightDB();

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
    }
];

async function runTask(task: Task) {
    console.log(\`[Cron] Running task: \${task.name}...\`);
    const page = await Browser.newPage({ profile: task.profile as any });
    try {
        const res = await page.goto(task.url);
        const title = await page.title();
        console.log(\`[Cron] \${task.name} success: \${title} (\${res.status})\`);
        
        db.saveScrape(task.url, task.profile, res.status, await page.content(), {
            taskName: task.name,
            title
        });
    } catch (err) {
        console.error(\`[Cron] \${task.name} failed:\`, err);
    } finally {
        await page.close();
    }
}

// Start all tasks using Bun's native cron engine
for (const task of tasks) {
    console.log(\`[Cron] Scheduling task: \${task.name} (\${task.intervalMs}ms interval)...\`);
    
    // Bun.cron expects a cron expression. Since we have intervalMs, 
    // we convert simple intervals to cron strings or stay with setInterval 
    // if they are sub-minute. For hours/minutes, cron is better.
    
    if (task.intervalMs >= 60_000) {
        const minutes = Math.floor(task.intervalMs / 60_000);
        const expression = \`*/\${minutes} * * * *\`;
        
        Bun.cron(expression, () => runTask(task));
    } else {
        // Fallback for high-frequency sub-minute tasks
        setInterval(() => runTask(task), task.intervalMs);
    }
}

console.log("⚡️ Bunlight Scheduler started.");
