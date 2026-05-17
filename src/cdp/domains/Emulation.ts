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
 * Emulation domain handler.
 *
 * Implements real state storage for device metrics, media type, user-agent,
 * geolocation, locale, and timezone overrides.  The stored values are consumed
 * by StaticDomTransport.#navigate (User-Agent and Accept-Language headers) and
 * available to Page.captureScreenshot (viewport dimensions).
 *
 * No-ops (touch emulation, scrollbars) are kept as stubs — static mode has no
 * rendering engine so these have no effect.
 */

import type { DomainHandler } from "../types.js";

export const EmulationHandler: DomainHandler = async (method, params, ctx, sessionId) => {
	switch (method) {
		// -----------------------------------------------------------------------
		// setDeviceMetricsOverride — store viewport dimensions + scale factor
		// -----------------------------------------------------------------------
		case "Emulation.setDeviceMetricsOverride": {
			const page = ctx.pageBySession(sessionId);
			const p = params as {
				width?: number;
				height?: number;
				deviceScaleFactor?: number;
				mobile?: boolean;
			};
			page.emulation.deviceMetrics = {
				width: typeof p.width === "number" ? p.width : 1280,
				height: typeof p.height === "number" ? p.height : 720,
				deviceScaleFactor: typeof p.deviceScaleFactor === "number" ? p.deviceScaleFactor : 1,
				mobile: typeof p.mobile === "boolean" ? p.mobile : false,
			};
			return {};
		}

		// -----------------------------------------------------------------------
		// clearDeviceMetricsOverride — reset to default 1280x720
		// -----------------------------------------------------------------------
		case "Emulation.clearDeviceMetricsOverride": {
			const page = ctx.pageBySession(sessionId);
			page.emulation.deviceMetrics = undefined;
			return {};
		}

		// -----------------------------------------------------------------------
		// setEmulatedMedia — store media type and media features
		// -----------------------------------------------------------------------
		case "Emulation.setEmulatedMedia": {
			const page = ctx.pageBySession(sessionId);
			const p = params as {
				media?: string;
				features?: Array<{ name: string; value: string }>;
			};
			if (p.media !== undefined) {
				page.emulation.mediaType = p.media;
			}
			if (p.features !== undefined) {
				page.emulation.mediaFeatures = p.features.map((f) => ({
					name: f.name,
					value: f.value,
				}));
			}
			return {};
		}

		// -----------------------------------------------------------------------
		// setUserAgentOverride — store UA, injected as User-Agent header on next navigate
		// -----------------------------------------------------------------------
		case "Emulation.setUserAgentOverride": {
			const page = ctx.pageBySession(sessionId);
			const p = params as { userAgent?: string };
			// Empty string clears the override (reverts to default Bxc UA)
			if (typeof p.userAgent === "string" && p.userAgent.length > 0) {
				page.emulation.userAgent = p.userAgent;
			} else {
				page.emulation.userAgent = undefined;
			}
			return {};
		}

		// -----------------------------------------------------------------------
		// setGeolocationOverride — store lat/lng/accuracy (no functional effect in static)
		// -----------------------------------------------------------------------
		case "Emulation.setGeolocationOverride": {
			const page = ctx.pageBySession(sessionId);
			const p = params as {
				latitude?: number;
				longitude?: number;
				accuracy?: number;
			};
			if (typeof p.latitude === "number" && typeof p.longitude === "number") {
				page.emulation.geolocation = {
					latitude: p.latitude,
					longitude: p.longitude,
					accuracy: typeof p.accuracy === "number" ? p.accuracy : 1,
				};
			} else {
				// No params means clear the override
				page.emulation.geolocation = undefined;
			}
			return {};
		}

		// -----------------------------------------------------------------------
		// setLocaleOverride — store locale, used as Accept-Language on next navigate
		// -----------------------------------------------------------------------
		case "Emulation.setLocaleOverride": {
			const page = ctx.pageBySession(sessionId);
			const p = params as { locale?: string };
			page.emulation.locale =
				typeof p.locale === "string" && p.locale.length > 0 ? p.locale : undefined;
			return {};
		}

		// -----------------------------------------------------------------------
		// setTimezoneOverride — store timezone identifier (no functional effect in static)
		// -----------------------------------------------------------------------
		case "Emulation.setTimezoneOverride": {
			const page = ctx.pageBySession(sessionId);
			const p = params as { timezoneId?: string };
			page.emulation.timezone =
				typeof p.timezoneId === "string" && p.timezoneId.length > 0 ? p.timezoneId : undefined;
			return {};
		}

		// -----------------------------------------------------------------------
		// setTouchEmulationEnabled — no-op (no rendering engine in static mode)
		// -----------------------------------------------------------------------
		case "Emulation.setTouchEmulationEnabled":
			return {};

		// -----------------------------------------------------------------------
		// setScrollbarsHidden — no-op (no rendering engine in static mode)
		// -----------------------------------------------------------------------
		case "Emulation.setScrollbarsHidden":
			return {};

		default:
			return null;
	}
};
