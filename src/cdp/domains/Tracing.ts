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
 * Tracing domain handler.
 *
 * Handles: Tracing.start, Tracing.end
 *
 * Events emitted:
 *   Tracing.dataCollected  — synthetic trace events batch at end
 *   Tracing.tracingComplete — signals end of trace
 *
 * In static mode a minimal synthetic trace is generated: it includes
 * metadata and a navigation-like frame event that gives agent-browser's
 * profiler command useful data without requiring a real Chrome trace.
 *
 * In fast/stealth/max mode (CDP proxy), these calls are delegated to
 * Lightpanda or Chrome which provide a real trace.
 */

import type { DispatchContext, DomainHandler } from "../types.js";

// ---------------------------------------------------------------------------
// Tracing state (module-scoped — one trace at a time per process)
// ---------------------------------------------------------------------------

interface TracingConfig {
	/** Milliseconds timestamp when tracing started. */
	startedAt: number;
	/** Categories requested by the caller (informational). */
	categories: string;
	/** Buffer usage threshold (0-1). */
	bufferUsageReportingInterval: number;
	/** Transfer mode (ReturnAsStream | ReportEvents). */
	transferMode: string;
}

let activeTrace: TracingConfig | null = null;
let traceCounter = 0;

/** Returns true if a trace is currently in progress. */
export function isTracingActive(): boolean {
	return activeTrace !== null;
}

// ---------------------------------------------------------------------------
// Synthetic trace generator
// ---------------------------------------------------------------------------

/**
 * Generates a minimal synthetic trace buffer for static mode.
 *
 * The format is a CDP `Tracing.dataCollected` compatible structure:
 * an array of trace event objects in the standard Trace Event Format (TEF).
 *
 * See https://docs.google.com/document/d/1CvAClvFfyA5R-PhYUmn5OOQtYMH4h6I0nSsKchNAySU
 */
function buildSyntheticTrace(
	config: TracingConfig,
): Array<Record<string, unknown>> {
	const pid = 1;
	const tid = 1;
	const startTs = config.startedAt * 1000; // microseconds

	return [
		// Metadata: process name
		{
			pid,
			tid,
			ph: "M",
			cat: "__metadata",
			name: "process_name",
			args: { name: "Bxc StaticDomTransport" },
			ts: startTs,
		},
		// Metadata: thread name
		{
			pid,
			tid,
			ph: "M",
			cat: "__metadata",
			name: "thread_name",
			args: { name: "CrBrowserMain" },
			ts: startTs,
		},
		// Navigation — begin
		{
			pid,
			tid,
			ph: "B",
			cat: "blink.user_timing,rail",
			name: "navigationStart",
			id: `0x${traceCounter.toString(16)}`,
			args: {
				data: {
					documentLoaderURL: "",
					isLoadingMainFrame: true,
					navigationId: `nav-${traceCounter}`,
					type: "Navigation",
				},
			},
			ts: startTs + 100,
		},
		// Navigation — end
		{
			pid,
			tid,
			ph: "E",
			cat: "blink.user_timing,rail",
			name: "navigationStart",
			id: `0x${traceCounter.toString(16)}`,
			args: {},
			ts: startTs + 200,
		},
		// Paint
		{
			pid,
			tid,
			ph: "I",
			cat: "blink",
			name: "PaintTiming",
			args: { data: { type: "first-paint" } },
			ts: startTs + 300,
			s: "t",
		},
		// First Contentful Paint
		{
			pid,
			tid,
			ph: "I",
			cat: "blink",
			name: "PaintTiming",
			args: { data: { type: "first-contentful-paint" } },
			ts: startTs + 350,
			s: "t",
		},
		// Layout
		{
			pid,
			tid,
			ph: "X",
			cat: "blink",
			name: "Layout",
			args: { beginData: { frame: "static-frame-0" } },
			ts: startTs + 120,
			dur: 50,
		},
		// Load event
		{
			pid,
			tid,
			ph: "I",
			cat: "blink.user_timing",
			name: "loadEventEnd",
			args: {},
			ts: startTs + 400,
			s: "t",
		},
	];
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const TracingHandler: DomainHandler = async (
	method,
	params,
	ctx,
	_sessionId,
) => {
	switch (method) {
		case "Tracing.start": {
			// If a trace is already active, starting a new one is a no-op
			// (Chrome raises an error; we silently reinitialize for robustness).
			const {
				categories = "",
				bufferUsageReportingInterval = 0,
				transferMode = "ReportEvents",
			} = params as {
				categories?: string;
				bufferUsageReportingInterval?: number;
				transferMode?: string;
			};

			activeTrace = {
				startedAt: Date.now(),
				categories,
				bufferUsageReportingInterval,
				transferMode,
			};
			traceCounter++;
			return {};
		}

		case "Tracing.end": {
			// Emit dataCollected (batch mode) then tracingComplete.
			const trace = activeTrace;
			activeTrace = null;

			const events = buildSyntheticTrace(
				trace ?? {
					startedAt: Date.now() - 100,
					categories: "",
					bufferUsageReportingInterval: 0,
					transferMode: "ReportEvents",
				},
			);

			// Emit trace data as one batch.
			emitDataCollected(ctx, events);

			// Signal end of trace.
			emitTracingComplete(ctx);
			return {};
		}

		default:
			return null;
	}
};

// ---------------------------------------------------------------------------
// Event helpers
// ---------------------------------------------------------------------------

/** Emits Tracing.dataCollected with the given events array. */
export function emitDataCollected(
	ctx: DispatchContext,
	value: Array<Record<string, unknown>>,
): void {
	ctx.emitEvent({
		method: "Tracing.dataCollected",
		params: { value },
	});
}

/** Emits Tracing.tracingComplete. */
export function emitTracingComplete(ctx: DispatchContext): void {
	ctx.emitEvent({
		method: "Tracing.tracingComplete",
		params: {
			dataLossOccurred: false,
		},
	});
}
