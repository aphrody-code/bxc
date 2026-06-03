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
 * WebMCP domain handler.
 *
 * Non-standard extension domain used by agent-browser / Puppeteer forks that
 * expose the Model Context Protocol over CDP.
 *
 * Stubs out WebMCP.enable so the connection handshake succeeds.
 */

import type { DomainHandler } from "../types.ts";

export const WebMCPHandler: DomainHandler = async (
	method,
	_params,
	_ctx,
	_sessionId,
) => {
	switch (method) {
		case "WebMCP.enable":
			return {};

		default:
			return null;
	}
};
