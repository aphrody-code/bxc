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

import { google } from "../../google/index.ts";

export default {
	async fetch(req: Request) {
		const u = new URL(req.url);
		const q = u.searchParams.get("q");
		if (!q)
			return Response.json(
				{ ok: false, error: "missing 'q'" },
				{ status: 400 },
			);

		const hl = u.searchParams.get("hl") ?? "en";
		const gl = u.searchParams.get("gl") ?? "US";
		const cacheTtlMs = Number(u.searchParams.get("cacheTtlMs") ?? 300000);

		const results = await google.search(q, { hl, gl, cacheTtlMs });

		return Response.json({
			ok: true,
			query: q,
			results,
		});
	},
};
