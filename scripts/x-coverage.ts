#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
import { XClient, XSession, buildCoverageReport } from "@aphrody-code/x";

const probe = process.argv.includes("--probe");
let client: XClient | undefined;
if (probe) {
  client = new XClient(XSession.loadOrEnv());
}
const report = await buildCoverageReport(client, {
  probePremium: probe,
  checkQueryIds: true,
});
console.log(JSON.stringify(report, null, 2));