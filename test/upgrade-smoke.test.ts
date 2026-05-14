import { test, expect } from "bun:test";
import { Browser } from "../src/api/browser.ts";

test("Profile hot-upgrade smoke test", async () => {
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
}, 10000);
