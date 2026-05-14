import { test, expect } from "bun:test";
import { Browser } from "../src/api/browser.ts";

test("Frame management smoke test", async () => {
  const page = await Browser.newPage({ profile: "static" });
  
  const mainFrame = page.mainFrame();
  expect(mainFrame).toBeDefined();
  expect(page.frames()).toContain(mainFrame);
  expect(mainFrame.parentFrame()).toBeNull();

  // Test content extraction from frame
  await page.setContent("<h1>Frame Test</h1>");
  expect(await mainFrame.content()).toContain("<h1>Frame Test</h1>");
  expect(await mainFrame.title()).toBe("");

  await page.close();
  await Browser.close();
});
