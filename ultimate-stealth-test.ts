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

import { Browser } from "./src/api/browser.ts";

async function runUltimateStealthTest() {
    console.log("────────────────────────────────────────────────────────────");
    console.log("  Ultimate Stealth Test (Google Accounts - Bot Detection)");
    console.log("────────────────────────────────────────────────────────────");
    console.log("Note: x.com is strictly forbidden by the testing mandates.");
    console.log("Executing against accounts.google.com to verify maximum stealth.\n");

    const page = await Browser.newPage({
        profile: "stealth",
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        httpOpts: { profile: "chrome131" }
    });

    try {
        console.log("Navigating to https://accounts.google.com/ServiceLogin...");
        const res = await page.goto("https://accounts.google.com/ServiceLogin");
        
        await Bun.sleep(2000); // Wait for potential bot checks to pass

        const title = await page.title();
        const content = await page.content();

        console.log(`\nResponse Status: ${res.status} ${res.statusText}`);
        console.log(`Page Title: ${title}`);
        console.log(`Content Size: ${content.length} characters`);

        if (res.status === 200 && title.includes("Sign in")) {
            console.log("\n✅ ULTIMATE STEALTH TEST PASSED. NO CAPTCHA DETECTED.");
        } else {
            console.error("\n❌ STEALTH TEST FAILED. BOT DETECTED.");
            process.exit(1);
        }
    } catch (e) {
        console.error("Test execution failed:", e);
        process.exit(1);
    } finally {
        await page.close();
        await Browser.close();
    }
}

runUltimateStealthTest().catch(console.error);
