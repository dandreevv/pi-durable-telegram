export type ChatAction = "typing" | "upload_photo" | "upload_document";

export type SendOptions = {
	/** Parse as Telegram HTML; plain text otherwise. */
	readonly html?: boolean;
	/** Reply to this message of the chat (sent anyway if it is gone). */
	readonly replyTo?: number;
	/** No automatic retries: a 429 or network error is returned to the caller at once (previews, typing). */
	readonly fast?: boolean;
};

export type BotCommandSpec = { readonly command: string; readonly description: string };

/**
 * The Telegram surface the channel uses; the grammY implementation is `createGrammyPort`, tests use fakes. Methods
 * throw `TelegramApiError`, `TelegramUnknown` (non-idempotent call with unknown outcome) or `TelegramUnavailable`.
 */
export interface TelegramPort {
	sendMessage(chatId: number, text: string, options: SendOptions, signal?: AbortSignal): Promise<number>;
	editMessageText(
		chatId: number,
		messageId: number,
		text: string,
		options: SendOptions,
		signal?: AbortSignal,
	): Promise<void>;
	sendChatAction(chatId: number, action: ChatAction, signal?: AbortSignal): Promise<void>;
	sendPhoto(chatId: number, path: string, caption: string | undefined, signal?: AbortSignal): Promise<number>;
	sendDocument(chatId: number, path: string, caption: string | undefined, signal?: AbortSignal): Promise<number>;
	/** `getFile`: the server path to download, and the size when Telegram reports it. */
	getFile(fileId: string, signal?: AbortSignal): Promise<{ path: string; size?: number }>;
	/** Download a file returned by `getFile`. The URL carries the bot token; implementations must not log it. */
	downloadFile(filePath: string, signal: AbortSignal): Promise<Response>;
	setMyCommands(commands: readonly BotCommandSpec[]): Promise<void>;
}
