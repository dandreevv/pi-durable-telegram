import type { Update } from "grammy/types";

let nextUpdateId = 1;
const DATE = 1_790_000_000;

export function textUpdate(
	chatId: number,
	messageId: number,
	text: string,
	options: { fromId?: number; chatType?: "private" | "group"; isBot?: boolean } = {},
): Update {
	const fromId = options.fromId ?? chatId;
	const chat =
		options.chatType === "group"
			? { id: chatId, type: "group" as const, title: "g" }
			: { id: chatId, type: "private" as const, first_name: "U" };
	return {
		update_id: nextUpdateId++,
		message: {
			message_id: messageId,
			date: DATE,
			chat,
			from: { id: fromId, is_bot: options.isBot ?? false, first_name: "U" },
			text,
		},
	} as Update;
}

export function photoUpdate(chatId: number, messageId: number, fileId: string, size: number, caption?: string): Update {
	return {
		update_id: nextUpdateId++,
		message: {
			message_id: messageId,
			date: DATE,
			chat: { id: chatId, type: "private", first_name: "U" },
			from: { id: chatId, is_bot: false, first_name: "U" },
			photo: [
				{ file_id: `${fileId}-small`, file_unique_id: "s", width: 90, height: 90, file_size: 10 },
				{ file_id: fileId, file_unique_id: "b", width: 800, height: 600, file_size: size },
			],
			...(caption === undefined ? {} : { caption }),
		},
	} as Update;
}

export function documentUpdate(chatId: number, messageId: number, fileId: string, name: string, size: number): Update {
	return {
		update_id: nextUpdateId++,
		message: {
			message_id: messageId,
			date: DATE,
			chat: { id: chatId, type: "private", first_name: "U" },
			from: { id: chatId, is_bot: false, first_name: "U" },
			document: { file_id: fileId, file_unique_id: "d", file_name: name, file_size: size },
		},
	} as Update;
}

export function voiceUpdate(chatId: number, messageId: number, fileId: string, size: number): Update {
	return {
		update_id: nextUpdateId++,
		message: {
			message_id: messageId,
			date: DATE,
			chat: { id: chatId, type: "private", first_name: "U" },
			from: { id: chatId, is_bot: false, first_name: "U" },
			voice: { file_id: fileId, file_unique_id: "v", duration: 2, file_size: size },
		},
	} as Update;
}
