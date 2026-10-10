import type { Update } from "grammy/types";

export type AccessDecision =
	| { readonly allowed: true; readonly chatId: number; readonly userId: number }
	| { readonly allowed: false; readonly reason: string; readonly fields: Readonly<Record<string, unknown>> };

/** The kind of an update, for logs: its first payload field. */
export function updateKind(update: Update): string {
	return Object.keys(update).find((key) => key !== "update_id") ?? "unknown";
}

/**
 * Only private messages from allow-listed, non-bot users in their own chat pass. The log fields carry ids and the
 * update kind, never text or captions.
 */
export function checkAccess(update: Update, allowed: ReadonlySet<number>): AccessDecision {
	const message = update.message;
	const fields = {
		update_id: update.update_id,
		kind: updateKind(update),
		from: message?.from?.id,
		chat: message?.chat.id,
		chat_type: message?.chat.type,
	};
	const deny = (reason: string): AccessDecision => ({ allowed: false, reason, fields: { ...fields, reason } });
	if (message === undefined) return deny("not_a_message");
	if (message.chat.type !== "private") return deny("not_private");
	const from = message.from;
	if (from === undefined) return deny("no_sender");
	if (from.is_bot) return deny("bot_sender");
	if (from.id !== message.chat.id) return deny("sender_not_chat");
	if (!allowed.has(from.id)) return deny("not_allowed");
	return { allowed: true, chatId: message.chat.id, userId: from.id };
}
