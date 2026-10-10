import type { JsonValue } from "@earendil-works/chord";
import { truncate } from "../format/escape.ts";
import { redact } from "../runtime/redact.ts";

/** First line of a durable `detail`, redacted and at most `max` characters. */
export function trimDetail(detail: JsonValue | undefined, max = 300): string | undefined {
	if (detail === undefined || detail === null) return undefined;
	const text = typeof detail === "string" ? detail : JSON.stringify(detail);
	const line = text.split("\n").find((each) => each.trim() !== "") ?? "";
	const clean = truncate(redact(line.trim()), max);
	return clean === "" ? undefined : clean;
}

const authPattern = /401|403|oauth|unauthori[sz]ed|invalid.*(token|key)|expired|credential|not logged in|no auth/i;
const overloadPattern = /429|rate.?limit|overloaded|529|too many requests/i;

/** The one line a user sees when a request got no answer; undefined when nothing should be said. */
export function unansweredText(
	reason: string,
	detail: string | undefined,
	model: { provider: string; modelId: string },
): string | undefined {
	switch (reason) {
		case "aborted":
			return undefined;
		case "model_error":
			return modelErrorText(detail ?? "", model.provider);
		case "no_model":
			return `⚠ Model ${model.provider}/${model.modelId} is not available (check PI_PROVIDER/PI_MODEL).`;
		case "faulted":
			return `⚠ Internal error: ${truncate(detail ?? "unknown", 200)}.`;
		case "reset":
			return "Context was reset; this request was dropped.";
		default:
			return `⚠ Request not answered (${reason}).`;
	}
}

function modelErrorText(detail: string, provider: string): string {
	if (authPattern.test(detail))
		return `⚠ Model auth failed: run \`pi-durable-telegram login ${provider}\` on the server.`;
	if (overloadPattern.test(detail)) return "⚠ Provider is overloaded or rate-limited, try again later.";
	return `⚠ Model error: ${truncate(detail === "" ? "unknown" : detail, 200)}.`;
}

/** Reasons after which queued messages stay in the inbox until something places them. */
export function stallsQueue(reason: string): boolean {
	return reason === "model_error" || reason === "faulted" || reason === "no_model";
}
