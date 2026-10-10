import { tail } from "../format/escape.ts";
import { fenceStateAfter } from "../format/fence.ts";
import { markdownToTelegramHtml } from "../format/markdown-html.ts";
import type { Logger } from "../runtime/log.ts";
import { classifyTelegramError, telegramErrorSummary } from "../telegram/errors.ts";
import type { TelegramPort } from "../telegram/port.ts";

const PREVIEW_CHARS = 3500;
export const EDIT_INTERVAL_MS = 1000;

export type PreviewFrame = { readonly text: string; readonly hint: string | undefined };

export type PreviewOptions = {
	readonly port: TelegramPort;
	readonly chatId: number;
	readonly replyTo: number;
	readonly log: Logger;
	/** Existing preview message from an earlier invocation: edited, never re-sent. */
	readonly messageId: number | undefined;
	/** Persist a newly sent preview's id before anything else happens to it. */
	readonly onCreated: (messageId: number) => Promise<void>;
	readonly signal?: AbortSignal;
	readonly now?: () => number;
	readonly intervalMs?: number;
};

/** Render the visible part of a streaming answer: its tail, with the fence it is inside reopened, plus a tool hint. */
export function renderPreview(frame: PreviewFrame): string {
	let body = frame.text;
	if (body.length > PREVIEW_CHARS) {
		const kept = tail(body, PREVIEW_CHARS);
		const fence = fenceStateAfter(body.slice(0, body.length - kept.length), undefined);
		body = `${fence === undefined ? "" : `${fence.line}\n`}…${kept}`;
	}
	const hint = frame.hint === undefined ? "" : `\n\n⚙ ${frame.hint}`;
	return `${body}${hint}`.trim();
}

/**
 * Streams one Telegram message by editing it: at most one edit in flight and one per interval, the newest frame
 * wins, a 429 sets a cooldown and drops the frame. Never throws; failures are logged.
 */
export class PreviewStreamer {
	readonly #o: PreviewOptions;
	readonly #now: () => number;
	#messageId: number | undefined;
	#latest: string | undefined;
	#lastSent = "";
	#lastEditAt = 0;
	#cooldownUntil = 0;
	#inFlight: Promise<void> | undefined;
	#timer: NodeJS.Timeout | undefined;
	#closed = false;

	constructor(options: PreviewOptions) {
		this.#o = options;
		this.#now = options.now ?? Date.now;
		this.#messageId = options.messageId;
	}

	get messageId(): number | undefined {
		return this.#messageId;
	}

	push(frame: PreviewFrame): void {
		if (this.#closed) return;
		const rendered = renderPreview(frame);
		if (rendered === "") return;
		this.#latest = rendered;
		this.#schedule();
	}

	/** Stop streaming; waits for an in-flight send so a new preview id is persisted. */
	async close(): Promise<void> {
		this.#closed = true;
		if (this.#timer !== undefined) clearTimeout(this.#timer);
		this.#timer = undefined;
		await this.#inFlight;
	}

	#schedule(): void {
		if (this.#timer !== undefined || this.#inFlight !== undefined || this.#closed) return;
		const interval = this.#o.intervalMs ?? EDIT_INTERVAL_MS;
		const wait = Math.max(0, this.#lastEditAt + interval - this.#now(), this.#cooldownUntil - this.#now());
		this.#timer = setTimeout(() => {
			this.#timer = undefined;
			this.#flush();
		}, wait);
		this.#timer.unref();
	}

	#flush(): void {
		const text = this.#latest;
		if (this.#closed || text === undefined || text === this.#lastSent) return;
		this.#lastEditAt = this.#now();
		this.#inFlight = this.#send(text).finally(() => {
			this.#inFlight = undefined;
			if (this.#latest !== this.#lastSent) this.#schedule();
		});
	}

	async #send(text: string): Promise<void> {
		try {
			await this.#deliver(text);
			this.#lastSent = text;
		} catch (error) {
			this.#handleError(error, text);
		}
	}

	async #deliver(text: string): Promise<void> {
		const { port, chatId, signal } = this.#o;
		const html = markdownToTelegramHtml(text, { autoCloseFence: true });
		const options = { fast: true };
		const id = this.#messageId;
		if (id !== undefined) {
			await withPlainFallback(
				() => port.editMessageText(chatId, id, html, { ...options, html: true }, signal),
				() => port.editMessageText(chatId, id, text, options, signal),
			);
			return;
		}
		const sent = await withPlainFallback(
			() => port.sendMessage(chatId, html, { ...options, html: true, replyTo: this.#o.replyTo }, signal),
			() => port.sendMessage(chatId, text, { ...options, replyTo: this.#o.replyTo }, signal),
		);
		this.#messageId = sent;
		await this.#o.onCreated(sent);
	}

	#handleError(error: unknown, text: string): void {
		const kind = classifyTelegramError(error);
		if (kind.kind === "not_modified") this.#lastSent = text;
		else if (kind.kind === "retry_after") this.#cooldownUntil = this.#now() + kind.seconds * 1000;
		else if (kind.kind !== "aborted") this.#o.log.debug("preview_failed", telegramErrorSummary(error));
	}
}

/** Run `html`; when Telegram rejects the entities, run `plain` once instead. */
export async function withPlainFallback<T>(html: () => Promise<T>, plain: () => Promise<T>): Promise<T> {
	try {
		return await html();
	} catch (error) {
		if (classifyTelegramError(error).kind !== "parse_error") throw error;
		return plain();
	}
}
