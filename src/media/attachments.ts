import { join, relative } from "node:path";
import type { Message, PhotoSize } from "grammy/types";
import { extensionForMime, sanitizeFileName } from "./safe-name.ts";

export type Attachment = {
	readonly kind: "photo" | "document";
	readonly fileId: string;
	readonly fileSize: number | undefined;
	readonly name: string;
	readonly mime: string | undefined;
};

export type VoiceNote = {
	readonly kind: "voice" | "audio" | "video_note";
	readonly fileId: string;
	readonly fileSize: number | undefined;
	readonly mime: string;
};

/** The largest size of a photo. */
export function pickPhoto(photo: readonly PhotoSize[]): PhotoSize | undefined {
	return [...photo].sort((a, b) => (a.file_size ?? a.width * a.height) - (b.file_size ?? b.width * b.height)).at(-1);
}

export function attachmentOf(message: Message): Attachment | undefined {
	if (message.photo !== undefined && message.photo.length > 0) {
		const best = pickPhoto(message.photo);
		if (best === undefined) return undefined;
		return { kind: "photo", fileId: best.file_id, fileSize: best.file_size, name: "photo.jpg", mime: "image/jpeg" };
	}
	const doc = message.document;
	if (doc === undefined) return undefined;
	const name = doc.file_name ?? `file.${extensionForMime(doc.mime_type)}`;
	return { kind: "document", fileId: doc.file_id, fileSize: doc.file_size, name, mime: doc.mime_type };
}

export function voiceOf(message: Message): VoiceNote | undefined {
	if (message.voice !== undefined) {
		const { file_id, file_size } = message.voice;
		return { kind: "voice", fileId: file_id, fileSize: file_size, mime: "audio/ogg" };
	}
	if (message.video_note !== undefined) {
		const { file_id, file_size } = message.video_note;
		return { kind: "video_note", fileId: file_id, fileSize: file_size, mime: "video/mp4" };
	}
	if (message.audio !== undefined) {
		const { file_id, file_size, mime_type } = message.audio;
		return { kind: "audio", fileId: file_id, fileSize: file_size, mime: mime_type ?? "audio/mpeg" };
	}
	return undefined;
}

/** Local calendar date `YYYY-MM-DD`. */
export function localDate(at: Date): string {
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** `<workdir>/inbox/<date>/<messageId>-<safe name>`: deterministic, so a redelivered update overwrites, not duplicates. */
export function inboxPath(workdir: string, at: Date, messageId: number, name: string): string {
	return join(workdir, "inbox", localDate(at), `${messageId}-${sanitizeFileName(name)}`);
}

/** The user turn that tells the model where an attachment was saved. */
export function attachmentNote(options: {
	kind: "photo" | "document";
	workdir: string;
	path: string;
	isImage: boolean;
	caption: string | undefined;
}): string {
	const lines = [
		`[attachment] ${options.kind} saved to ${relative(options.workdir, options.path)} (absolute: ${options.path})`,
	];
	if (options.isImage) lines.push("View it with the read tool.");
	if (options.caption !== undefined && options.caption.trim() !== "") lines.push(`Caption: ${options.caption}`);
	return lines.join("\n");
}
