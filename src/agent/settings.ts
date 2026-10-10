import type { HarnessSettings } from "@earendil-works/pi-durable";

/** How often streamed partials are committed; Telegram shows about one edit per second anyway. */
export const PARTIAL_INTERVAL_MS = 300;

/**
 * Harness settings. `contextCap` limits the context the model works with: compaction starts when the context grows
 * past it, by keeping `contextWindow - contextCap` tokens in reserve.
 */
export function createSettings(options: { contextCap?: number; contextWindow?: number } = {}): HarnessSettings {
	const { contextCap, contextWindow } = options;
	const capped = contextCap !== undefined && contextWindow !== undefined && contextCap < contextWindow;
	return {
		progress: { partialIntervalMs: PARTIAL_INTERVAL_MS, outputIntervalMs: 500 },
		...(capped ? { compaction: { reserveTokens: contextWindow - contextCap } } : {}),
	};
}
