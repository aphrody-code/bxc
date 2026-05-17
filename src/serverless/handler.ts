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
 * @module bunlight/serverless/handler
 * 
 * Serverless-friendly Bunlight handler using Bun.FileSystemRouter.
 */

import { join } from "node:path";

const router = new Bun.FileSystemRouter({
	style: "nextjs",
	dir: join(import.meta.dir, "routes"),
});

function withHeaders(res: Response): Response {
	res.headers.set("cache-control", "no-store");
	return res;
}

export async function handler(req: Request): Promise<Response> {
	const match = router.match(req);
	
	if (match) {
		try {
			const route = await import(match.filePath);
			if (route.default && typeof route.default.fetch === "function") {
				const res = await route.default.fetch(req, match.params);
				return withHeaders(res);
			}
		} catch (e) {
			return withHeaders(Response.json({ ok: false, error: (e as Error).message }, { status: 500 }));
		}
	}

	return withHeaders(Response.json({ ok: false, error: "Not Found" }, { status: 404 }));
}
