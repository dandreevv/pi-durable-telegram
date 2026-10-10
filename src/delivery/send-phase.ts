import type { Context } from "@earendil-works/chord";
import {
	AssistantEntry,
	type ConversationId,
	InboxDoc,
	type NextTaskState,
	type RunningTask,
	type TaskRuntime,
	UserEntry,
} from "@earendil-works/pi-durable";
import { Delivered } from "../channel/docs.ts";
import { type Chunk, splitForTelegram } from "../format/chunk.ts";
import { escapeHtml } from "../format/escape.ts";
import { errorSummary } from "../runtime/log.ts";
import { classifyTelegramError, telegramErrorSummary } from "../telegram/errors.ts";
import type { TelegramPort } from "../telegram/port.ts";
import { finalReplyText } from "./final-text.ts";
import { stallsQueue, unansweredText } from "./outcome.ts";
import { withPlainFallback } from "./preview.ts";
import type { DeliverInput, DeliverState, DeliveryDeps, Outcome, SendState } from "./types.ts";
import { terminal } from "./wait-phase.ts";

type Runtime = TaskRuntime<DeliverInput, DeliverState, null, object>;
type Next = NextTaskState<DeliverState, null>;
type Task = RunningTask<DeliverInput, SendState, null>;

const MAX_RATE_LIMIT_WAITS = 5;
/** Pauses between attempts of the final preview edit while Telegram is unreachable; then a new message is sent. */
export const EDIT_RETRY_DELAYS_MS: readonly number[] = [2000, 4000, 8000, 16000, 30000];
export const STOPPED_TEXT = "⏹ stopped";
export const SHARED_TEXT = "↑ answered above";
export const EMPTY_TEXT = "(empty answer)";

type Job = { task: Task; runtime: Runtime; context: Context; deps: DeliveryDeps; port: TelegramPort };

/**
 * Phase `send`: render the outcome and deliver it chunk by chunk with durable progress. Chunk 0 edits the preview
 * when there is one (idempotent); other chunks are non-idempotent sends guarded by `inFlight`, so a crash between a
 * send and its record skips that chunk instead of sending it twice.
 */
export async function sendPhase(task: Task, runtime: Runtime, context: Context, deps: DeliveryDeps): Promise<void> {
	const job: Job = { task, runtime, context, deps, port: deps.port() };
	const chunks = await renderOutcome(job);
	let state = task.state.checkpoint;
	for (let index = state.sent; index < chunks.length; index++) {
		state = await deliverChunk(job, index, chunks[index] as Chunk, state);
	}
	await finish(job, state);
}

async function renderOutcome(job: Job): Promise<Chunk[]> {
	const { outcome, preview } = job.task.state.checkpoint;
	if (outcome.kind === "answer") return splitForTelegram(await answerText(job, outcome.entryId));
	if (outcome.kind === "shared") return preview === undefined ? [] : [plainChunk(SHARED_TEXT)];
	const text = unansweredText(outcome.reason, outcome.detail, job.deps.model);
	if (text !== undefined) return [plainChunk(text)];
	return outcome.reason === "aborted" && preview !== undefined ? [plainChunk(STOPPED_TEXT)] : [];
}

async function answerText(job: Job, entryId: number): Promise<string> {
	const entry = await job.runtime.entry(AssistantEntry, entryId as never, job.context);
	return finalReplyText(entry?.model?.[0]) ?? EMPTY_TEXT;
}

function plainChunk(text: string): Chunk {
	return { html: escapeHtml(text), plain: text };
}

type Sent = { kind: "sent"; messageId: number } | { kind: "unknown" } | { kind: "failed" } | { kind: "gone" };
type Edited = Sent | { kind: "unavailable" };

async function deliverChunk(job: Job, index: number, chunk: Chunk, state: SendState): Promise<SendState> {
	const preview = state.preview;
	if (index === 0 && preview !== undefined) {
		const edited = await editWithRetries(job, preview.messageId, chunk);
		if (edited !== undefined) return record(job, state, index, edited);
	}
	if (state.inFlight === index) {
		job.deps.log.warn("delivery_unknown", { chat: job.task.input.chatId, chunk: index, reason: "restart during send" });
		return record(job, state, index, { kind: "unknown" });
	}
	const marked: SendState = { ...state, inFlight: index };
	await save(job, marked);
	const sent = await withRateLimit(job, () => sendNew(job, chunk, index === 0));
	return record(job, marked, index, sent);
}

async function record(job: Job, state: SendState, index: number, sent: Sent): Promise<SendState> {
	const { inFlight: _cleared, ...rest } = state;
	const next: SendState = { ...rest, sent: index + 1 };
	if (sent.kind === "sent") next.messageIds = [...state.messageIds, sent.messageId];
	if (sent.kind === "unknown" || state.unknown === true) next.unknown = true;
	await save(job, next);
	return next;
}

async function save(job: Job, state: SendState): Promise<void> {
	await job.runtime.commit((): Next => ({ status: "running", checkpoint: state }), job.context);
}

/**
 * The edit is idempotent, so an outage (network, 5xx) is waited out with backoff instead of being recorded as done.
 * `undefined`: the preview cannot carry the answer (deleted, or Telegram stayed down); a new message is sent.
 */
async function editWithRetries(job: Job, messageId: number, chunk: Chunk): Promise<Sent | undefined> {
	const delays = job.deps.editRetryDelaysMs ?? EDIT_RETRY_DELAYS_MS;
	for (let attempt = 0; ; attempt++) {
		const edited = await withRateLimit(job, () => editPreview(job, messageId, chunk));
		if (edited.kind === "gone") return undefined;
		if (edited.kind !== "unavailable") return edited;
		const delay = delays[attempt];
		if (delay === undefined) {
			job.deps.log.warn("preview_edit_gave_up", { chat: job.task.input.chatId, attempts: attempt + 1 });
			return undefined;
		}
		await job.runtime.sleep(job.runtime.now() + delay, job.context);
	}
}

async function editPreview(job: Job, messageId: number, chunk: Chunk): Promise<Edited> {
	const { port } = job;
	const { chatId } = job.task.input;
	const signal = job.runtime.signal;
	try {
		await withPlainFallback(
			() => port.editMessageText(chatId, messageId, chunk.html, { html: true }, signal),
			() => port.editMessageText(chatId, messageId, chunk.plain, {}, signal),
		);
		return { kind: "sent", messageId };
	} catch (error) {
		const kind = classifyTelegramError(error).kind;
		if (kind === "not_modified") return { kind: "sent", messageId };
		if (kind === "message_gone") return { kind: "gone" };
		if (kind === "unavailable") return { kind: "unavailable" };
		throw error;
	}
}

async function sendNew(job: Job, chunk: Chunk, first: boolean): Promise<Sent> {
	const { port } = job;
	const { chatId, messageId } = job.task.input;
	const signal = job.runtime.signal;
	const replyTo = first ? { replyTo: messageId } : {};
	const id = await withPlainFallback(
		() => port.sendMessage(chatId, chunk.html, { html: true, ...replyTo }, signal),
		() => port.sendMessage(chatId, chunk.plain, replyTo, signal),
	);
	return { kind: "sent", messageId: id };
}

/** Retry a Telegram call after 429 (nothing was sent); classify every other failure. Aborts propagate. */
async function withRateLimit<T extends Edited>(job: Job, call: () => Promise<T>): Promise<T | Sent> {
	for (let waits = 0; ; waits++) {
		const attempt = await attemptOnce(job, call, waits < MAX_RATE_LIMIT_WAITS);
		if (attempt.retryAfterMs === undefined) return attempt.sent;
		await job.runtime.sleep(job.runtime.now() + attempt.retryAfterMs, job.context);
	}
}

type Attempt<T> = { sent: T | Sent; retryAfterMs?: undefined } | { retryAfterMs: number };

async function attemptOnce<T extends Edited>(job: Job, call: () => Promise<T>, mayWait: boolean): Promise<Attempt<T>> {
	try {
		return { sent: await call() };
	} catch (error) {
		const kind = classifyTelegramError(error);
		if (kind.kind === "aborted" || job.runtime.signal.aborted) throw error;
		if (kind.kind === "retry_after" && mayWait) return { retryAfterMs: kind.seconds * 1000 };
		return { sent: failed(job, error, kind.kind) };
	}
}

function failed(job: Job, error: unknown, kind: string): Sent {
	const fields = { chat: job.task.input.chatId, kind, ...telegramErrorSummary(error) };
	if (kind === "unknown" || kind === "unavailable") {
		job.deps.log.warn("delivery_unknown", fields);
		return { kind: "unknown" };
	}
	job.deps.log.warn("delivery_failed", fields);
	return { kind: "failed" };
}

async function finish(job: Job, state: SendState): Promise<void> {
	const outcome = state.outcome;
	if (outcome.kind === "unanswered" && stallsQueue(outcome.reason)) await unstickQueue(job, outcome);
	await job.runtime.commit(async (tx): Promise<Next> => {
		if (outcome.kind === "answer") {
			const delivered = await tx.doc(Delivered, job.runtime.conversationId);
			const claim = delivered.answers[String(outcome.entryId)];
			if (claim !== undefined) claim.state = state.unknown === true ? "unknown" : "sent";
		}
		return terminal();
	}, job.context);
	job.deps.log.info("delivered", { chat: job.task.input.chatId, outcome: outcome.kind, chunks: state.sent });
}

/**
 * After a failed run, queued messages stay in the inbox until something places them; a passive write gives the
 * conversation that boundary. Idempotent by request id.
 */
async function unstickQueue(job: Job, outcome: Extract<Outcome, { kind: "unanswered" }>): Promise<void> {
	const id = job.runtime.conversationId;
	try {
		const inbox = await job.runtime.snapshot(InboxDoc, id, job.context);
		if ((inbox?.items.length ?? 0) === 0) return;
		await writeNote(job, id, `[previous request failed: ${outcome.reason}]`, `tg:unstick:${job.task.id}`);
	} catch (error) {
		if (job.runtime.signal.aborted) throw error;
		job.deps.log.warn("unstick_failed", { error: errorSummary(error) });
	}
}

async function writeNote(job: Job, id: ConversationId, text: string, requestId: string): Promise<void> {
	const conversation = await job.deps.harness().conversation(id, job.context);
	const message = { role: "user" as const, content: text, timestamp: job.runtime.now() };
	await conversation?.submit(
		{ type: "write", requestId, entry: { kind: UserEntry.kind, model: [message] } },
		job.context,
	);
}
