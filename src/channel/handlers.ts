import { open } from "node:fs/promises";
import { BACKGROUND_CONTEXT as BG } from "@earendil-works/chord/context";
import type { Message, Update } from "grammy/types";
import { probeImage } from "../agent/tools/image-probe.ts";
import { truncate } from "../format/escape.ts";
import { attachmentNote, attachmentOf, inboxPath, voiceOf } from "../media/attachments.ts";
import { type Stt, SttError, sttFailureText } from "../media/stt.ts";
import { isFatalHarnessError } from "../runtime/fatal.ts";
import { errorSummary } from "../runtime/log.ts";
import { DownloadError, downloadToFile, downloadToMemory } from "../telegram/download.ts";
import { checkAccess } from "./access.ts";
import { classifyMessage } from "./classify.ts";
import { runCompact } from "./commands/compact.ts";
import { runNew } from "./commands/new.ts";
import { runHelp } from "./commands/start-help.ts";
import { runStatus } from "./commands/status.ts";
import { runStop } from "./commands/stop.ts";
import { messageKey } from "./docs.ts";
import { admit, isKnown, recordKey } from "./intake.ts";
import { type ChannelRuntime, type MessageScope, reply } from "./scope.ts";

const MB = 1024 * 1024;

/**
 * Handle one update: access gate, duplicate check, then a command, text, attachment or voice path that ends by
 * admitting a delivery task. Never awaits a model run; long commands run detached. Never throws.
 */
export async function handleUpdate(rt: ChannelRuntime, update: Update): Promise<void> {
	try {
		await route(rt, update);
	} catch (error) {
		if (isFatalHarnessError(error)) rt.onFatal("storage failure while handling an update", error);
		else rt.log.error("update_failed", { update_id: update.update_id, error: errorSummary(error) });
	}
}

async function route(rt: ChannelRuntime, update: Update): Promise<void> {
	const access = checkAccess(update, rt.allowed);
	if (!access.allowed) {
		rt.log.info("update_ignored", access.fields);
		return;
	}
	const message = update.message as Message;
	const scope = await scopeFor(rt, message);
	if (await isKnown(rt.harness, scope.conversation, scope.key, BG)) {
		rt.log.info("update_duplicate", { update_id: update.update_id, chat: scope.chatId, message: scope.messageId });
		return;
	}
	await dispatch(scope);
}

async function scopeFor(rt: ChannelRuntime, message: Message): Promise<MessageScope> {
	const chatId = message.chat.id;
	const conversation = await rt.directory.get(chatId, BG);
	return {
		rt,
		conversation,
		message,
		chatId,
		messageId: message.message_id,
		key: messageKey(chatId, message.message_id),
	};
}

async function dispatch(scope: MessageScope): Promise<void> {
	const classified = classifyMessage(scope.message);
	switch (classified.kind) {
		case "command":
			return runCommand(scope, classified.name, classified.args);
		case "text":
			await admitContent(scope, classified.text);
			return;
		case "photo":
		case "document":
			return handleAttachment(scope);
		case "voice":
			return handleVoice(scope);
		default:
			return replyOnce(
				scope,
				`This kind of message (${classified.what}) is not supported. Send text, a photo, a document or voice.`,
			);
	}
}

async function runCommand(scope: MessageScope, name: string, args: string): Promise<void> {
	switch (name) {
		case "start":
		case "help":
			return runHelp(scope);
		case "status":
			return runStatus(scope);
		case "new":
			return detach(scope, "new", () => runNew(scope));
		case "stop":
			return detach(scope, "stop", () => runStop(scope));
		case "compact":
			return detach(scope, "compact", () => runCompact(scope, args));
		default:
			// Unknown commands go to the model as text: skills and prompts often use their own slash words.
			await admitContent(scope, scope.message.text ?? `/${name}`);
			return;
	}
}

/** Commands that wait on durable work run outside the update handler, so polling (and a later /stop) continues. */
function detach(scope: MessageScope, name: string, work: () => Promise<void>): void {
	scope.rt.track(
		work().catch((error: unknown) => {
			if (isFatalHarnessError(error)) scope.rt.onFatal(`storage failure in /${name}`, error);
			else scope.rt.log.error("command_failed", { command: name, error: errorSummary(error) });
		}),
	);
}

/** Admit the message for a model run; true when this call admitted it (false: a duplicate). */
async function admitContent(scope: MessageScope, content: string): Promise<boolean> {
	const input = { chatId: scope.chatId, messageId: scope.messageId, requestId: scope.key, content };
	const result = await admit(scope.conversation, scope.rt.deliver, input, BG);
	scope.rt.log.info(result === "admitted" ? "message_admitted" : "update_duplicate", {
		chat: scope.chatId,
		message: scope.messageId,
	});
	return result === "admitted";
}

/** Record the key, then reply once: a crash in between loses the reply rather than repeating it. */
async function replyOnce(scope: MessageScope, text: string): Promise<void> {
	if (await recordKey(scope.conversation, scope.key, BG)) await reply(scope, text);
}

async function handleAttachment(scope: MessageScope): Promise<void> {
	const attachment = attachmentOf(scope.message);
	if (attachment === undefined) return replyOnce(scope, "Could not read this attachment.");
	const limit = scope.rt.downloadLimit;
	if ((attachment.fileSize ?? 0) > limit) {
		return replyOnce(scope, `File is too big for bots (max ${Math.round(limit / MB)} MB).`);
	}
	const path = inboxPath(scope.rt.workdir, scope.rt.now(), scope.messageId, attachment.name);
	try {
		await downloadToFile({ port: scope.rt.port, fileId: attachment.fileId, limit }, path);
	} catch (error) {
		scope.rt.log.warn("download_failed", { chat: scope.chatId, error: errorSummary(error) });
		return replyOnce(
			scope,
			error instanceof DownloadError ? `Could not save the file: ${error.message}.` : "Could not save the file.",
		);
	}
	const isImage = attachment.kind === "photo" || (await sniffImage(path));
	const caption = scope.message.caption;
	await admitContent(
		scope,
		attachmentNote({ kind: attachment.kind, workdir: scope.rt.workdir, path, isImage, caption }),
	);
}

async function sniffImage(path: string): Promise<boolean> {
	const handle = await open(path, "r");
	try {
		const header = Buffer.alloc(4096);
		const { bytesRead } = await handle.read(header, 0, header.length, 0);
		return probeImage(header.subarray(0, bytesRead)) !== undefined;
	} finally {
		await handle.close();
	}
}

async function handleVoice(scope: MessageScope): Promise<void> {
	const voice = voiceOf(scope.message);
	const stt = scope.rt.stt;
	if (voice === undefined) return replyOnce(scope, "Could not read this voice message.");
	if (stt === undefined) return replyOnce(scope, "Voice messages are not configured (DEEPGRAM_API_KEY).");
	if ((voice.fileSize ?? 0) > scope.rt.downloadLimit)
		return replyOnce(scope, "Voice message is too big for bots (max 20 MB).");
	const transcript = await transcribe(scope, stt, voice.fileId, voice.mime);
	if (transcript === undefined) return;
	if (transcript.text === "") return replyOnce(scope, "Could not recognize speech.");
	const lang = transcript.language === undefined ? "" : `, lang=${transcript.language}`;
	// Echo only once admitted: a redelivered voice message (shutdown or crash before admit) is not echoed twice.
	if (await admitContent(scope, `[voice transcript${lang}] ${transcript.text}`))
		await reply(scope, `🎙 ${truncate(transcript.text, 4000)}`);
}

async function transcribe(scope: MessageScope, stt: Stt, fileId: string, mime: string) {
	try {
		const bytes = await downloadToMemory({ port: scope.rt.port, fileId, limit: scope.rt.downloadLimit });
		return await stt.transcribe(bytes, mime, AbortSignal.timeout(90_000));
	} catch (error) {
		scope.rt.log.warn("voice_failed", { chat: scope.chatId, error: errorSummary(error) });
		const text =
			error instanceof SttError ? sttFailureText(error.kind) : "Voice: could not download the audio, try again.";
		await replyOnce(scope, text);
		return undefined;
	}
}
