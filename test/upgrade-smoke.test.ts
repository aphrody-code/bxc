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

import { test, expect } from "bun:test";
import { Browser } from "../src/api/browser.ts";

test("Profile hot-upgrade smoke test", async () => {
  try {
    // Start with HTTP profile (fastest, no DOM)
    const page = await Browser.newPage({ profile: "http" });
    await page.goto("https://google.com");
    expect(page.profile()).toBe("http");
    
    // Upgrade to static profile (Zig DOM) without losing session
    const upgradedPage = await page.upgradeProfile("static");
    expect(upgradedPage.profile()).toBe("static");
    expect(upgradedPage.url()).toContain("google.com");
    
    // Can now use DOM methods
    const title = await upgradedPage.title();
    expect(title).toContain("Google");

    await upgradedPage.close();
    await Browser.close();
  } catch (err: any) {
    if (err.message?.includes("libcurl-impersonate not found")) {
      console.log("[upgrade-smoke] SKIP: curl-impersonate library not found");
      return;
    }
    throw err;
  }
}, 10000);
