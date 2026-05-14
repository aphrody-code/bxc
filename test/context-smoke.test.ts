import { test, expect } from "bun:test";
import { Browser } from "../src/api/browser.ts";

test("BrowserContext isolation smoke test", async () => {
  const context1 = await Browser.newContext();
  const context2 = await Browser.newContext();

  const page1 = await context1.newPage();
  const page2 = await context2.newPage();

  expect(page1.context()).toBe(context1);
  expect(page2.context()).toBe(context2);
  expect(context1.pages()).toContain(page1);
  expect(context2.pages()).toContain(page2);
  expect(context1.pages()).not.toContain(page2);

  // Cookie isolation test
  const cookie = { name: "test", value: "context1", domain: "example.com", path: "/", expires: 0, secure: false, httpOnly: false };
  await context1.addCookies([cookie]);
  
  expect(await context1.cookies()).toHaveLength(1);
  expect(await context2.cookies()).toHaveLength(0);

  await context1.close();
  await context2.close();
  await Browser.close();
});
