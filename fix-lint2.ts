import { readFileSync, writeFileSync } from "fs";

function fixFile(path: string, replacer: (content: string) => string) {
  try {
    const c = readFileSync(path, "utf8");
    const n = replacer(c);
    if (c !== n) writeFileSync(path, n);
  } catch (e) {}
}

fixFile("test/stealth-challenge.test.ts", c => c.replace("const resp = await page.goto(MOCK_URL);", "await page.goto(MOCK_URL);"));
fixFile("src/api/BrowserContext.ts", c => c.replace(/import type \{ Page \} from "\.\/browser\.ts";\n/, ""));
fixFile("src/cli/har.ts", c => c.replace(/\.\.\.\(\(stats as object\) \|\| \{\}\)/, "...(stats as object)"));
fixFile("src/stats/Statistics.ts", c => c.replace(/#windowDurationSum = 0;\n/, "").replace(/this\.#windowDurationSum \+= ms;\n/g, "").replace(/this\.#windowDurationSum -= evicted;\n/g, "").replace(/this\.#windowDurationSum = snap\.requestAvgFinishedDurationMs \* seedCount;\n/g, ""));

// Fix catch blocks
const catchFiles = [
  "src/ai/extractor.ts",
  "src/google/search.ts",
  "src/google/mass-scanner.ts",
  "src/utils/network-auditor.ts",
  "scripts/cleanup.ts",
  "src/api/Locator.ts",
  "src/api/browser.ts"
];

for (const file of catchFiles) {
  fixFile(file, c => c.replace(/catch \(_e\)/g, "catch").replace(/catch \(_err\)/g, "catch"));
}

console.log("Done");
