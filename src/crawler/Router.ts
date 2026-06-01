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
 * @module bxc/crawler/Router
 *
 * Simple route handler pattern matching Crawlee's Router design.
 */

import type { CrawlContext } from "./Crawler.ts";

type HandlerFn<ContextType> = (context: ContextType) => Promise<void>;

export class Router<ContextType extends CrawlContext> {
	private handlers = new Map<string, HandlerFn<ContextType>>();
	private defaultHandler: HandlerFn<ContextType> | null = null;

	addHandler(label: string, handler: HandlerFn<ContextType>): void {
		this.handlers.set(label, handler);
	}

	addDefaultHandler(handler: HandlerFn<ContextType>): void {
		this.defaultHandler = handler;
	}

	getHandler(label?: string): HandlerFn<ContextType> {
		if (label && this.handlers.has(label)) {
			return this.handlers.get(label)!;
		}
		if (this.defaultHandler) {
			return this.defaultHandler;
		}
		throw new Error(`No handler registered for label: ${label ?? "default"}`);
	}

	createRequestHandler(): HandlerFn<ContextType> {
		return async (context) => {
			let label: string | undefined;
			const req = context.request as any;
			if (req.userData && typeof req.userData === "object") {
				label = req.userData.label;
			}
			if (!label && req.payload) {
				try {
					const parsed = JSON.parse(req.payload);
					label = parsed.userData?.label;
				} catch {
					// Ignore
				}
			}
			const handler = this.getHandler(label);
			await handler(context);
		};
	}
}

export function createRouter<
	ContextType extends CrawlContext,
>(): Router<ContextType> {
	return new Router<ContextType>();
}
