import { defineDoc } from "@earendil-works/pi-durable";

/** Telegram chat id → durable conversation id; one conversation per allowed private chat. */
export const ChatMap = defineDoc<{ chats: Record<string, number> }>({
	kind: "tg.chats",
	version: 1,
	scope: "session",
	initial: () => ({ chats: {} }),
});

/** The Telegram chat a conversation belongs to, so tools and tasks find it from `conversationId`. */
export const ChatInfo = defineDoc<{ chatId: number }>({
	kind: "tg.chat",
	version: 1,
	scope: "conversation",
	history: "latest",
	fork: "initial",
	initial: () => ({ chatId: 0 }),
});

/** Ring of recently admitted Telegram message keys (`tg:<chat>:<message>`): redelivered updates are dropped. */
export const Intake = defineDoc<{ keys: string[] }>({
	kind: "tg.intake",
	version: 1,
	scope: "conversation",
	history: "latest",
	fork: "initial",
	initial: () => ({ keys: [] }),
});

export const INTAKE_RING_SIZE = 2000;

export type DeliveryState = "sending" | "sent" | "unknown";

/** Which answer entries were claimed for delivery, by which task: an answer is sent to Telegram once. */
export const Delivered = defineDoc<{
	answers: Record<string, { taskId: number; state: DeliveryState }>;
	order: number[];
}>({
	kind: "tg.delivered",
	version: 1,
	scope: "conversation",
	history: "latest",
	fork: "initial",
	initial: () => ({ answers: {}, order: [] }),
});

export const DELIVERED_RING_SIZE = 500;

/** The exact Markdown of recently sent messages with callback buttons, by message id: a tap marks its choice there. */
export const Buttons = defineDoc<{ messages: Record<string, string>; order: number[] }>({
	kind: "tg.buttons",
	version: 1,
	scope: "conversation",
	history: "latest",
	fork: "initial",
	initial: () => ({ messages: {}, order: [] }),
});

export const BUTTONS_RING_SIZE = 50;

/** Keep `markdown` as the text of `messageId`, dropping the oldest messages beyond `BUTTONS_RING_SIZE`. */
export function rememberButtons(
	doc: { messages: Record<string, string>; order: number[] },
	messageId: number,
	markdown: string,
): void {
	if (!Object.hasOwn(doc.messages, String(messageId))) doc.order.push(messageId);
	doc.messages[String(messageId)] = markdown;
	while (doc.order.length > BUTTONS_RING_SIZE) delete doc.messages[String(doc.order.shift())];
}

/** `tg:<chatId>:<messageId>`: the intake key and the durable request id of the message's submission. */
export function messageKey(chatId: number, messageId: number): string {
	return `tg:${chatId}:${messageId}`;
}

/** Add `key` to a ring, dropping the oldest beyond `size`; false when it was already present. */
export function pushRing(keys: string[], key: string, size: number): boolean {
	if (keys.includes(key)) return false;
	keys.push(key);
	if (keys.length > size) keys.splice(0, keys.length - size);
	return true;
}
