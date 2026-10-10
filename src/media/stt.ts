export type SttErrorKind = "auth" | "quota" | "unavailable" | "bad_audio";

export class SttError extends Error {
	readonly kind: SttErrorKind;
	constructor(kind: SttErrorKind, message: string) {
		super(message);
		this.name = "SttError";
		this.kind = kind;
	}
}

export type Transcript = { readonly text: string; readonly language?: string };

/** Speech to text; pluggable so another service can replace Deepgram. */
export interface Stt {
	transcribe(bytes: Uint8Array, mime: string, signal: AbortSignal): Promise<Transcript>;
}

/** One line for the user per failure kind. */
export function sttFailureText(kind: SttErrorKind): string {
	switch (kind) {
		case "auth":
			return "Voice: the speech service rejected the API key (DEEPGRAM_API_KEY).";
		case "quota":
			return "Voice: the speech service quota or rate limit is exhausted, try later or send text.";
		case "bad_audio":
			return "Voice: the speech service could not decode this audio.";
		default:
			return "Voice: speech service unavailable, try again or send text.";
	}
}
