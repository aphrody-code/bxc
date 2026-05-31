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

import type { AnyPage } from "../api/types.ts";

/**
 * Parses natural language and acts on the page using semantic locators.
 * Highly simplified version of an agentic interaction.
 *
 * E.g., `page.aiAct("Click the login button")`
 */
export async function aiActDOM(
	page: AnyPage,
	instruction: string,
): Promise<void> {
	const actionMatch = instruction
		.toLowerCase()
		.match(/^(click|fill|type|type in)\s+(.+)$/);
	if (!actionMatch) {
		throw new Error(
			"Currently only simple 'click <target>' or 'fill <target>' instructions are supported for aiAct.",
		);
	}

	const [, verb, target] = actionMatch;

	// We use semantic locators powered by the python bridge we refined earlier
	const locator = page.locator(`@semantic: ${target}`);

	if (verb === "click") {
		await locator.click();
	} else if (verb === "fill" || verb.startsWith("type")) {
		// We'll need a generic 'test' value for now, or parse it out of the instruction
		// In a real AI actor, the LLM provides the args.
		const fillMatch = target.match(/(.+?)\s+with\s+(.+)$/);
		if (fillMatch) {
			const [, actualTarget, value] = fillMatch;
			const fillLocator = page.locator(`@semantic: ${actualTarget}`);
			await fillLocator.fill(value.replace(/['"]/g, ""));
		} else {
			throw new Error(
				"Fill instructions must be in the format: fill <target> with <value>",
			);
		}
	}
}
