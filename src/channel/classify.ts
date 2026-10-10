import type { Message } from "grammy/types";

export type Classified =
	| { readonly kind: "command"; readonly name: string; readonly args: string }
	| { readonly kind: "text"; readonly text: string }
	| { readonly kind: "photo" | "document" }
	| { readonly kind: "voice" }
	| { readonly kind: "unsupported"; readonly what: string };

/** What an incoming message is, by its content. Pure. */
export function classifyMessage(message: Message): Classified {
	if (message.text !== undefined) return classifyText(message.text);
	if (message.photo !== undefined && message.photo.length > 0) return { kind: "photo" };
	if (message.document !== undefined) return { kind: "document" };
	if (message.voice !== undefined || message.audio !== undefined || message.video_note !== undefined)
		return { kind: "voice" };
	const what = ["sticker", "video", "animation", "location", "contact", "poll", "dice"].find((key) => key in message);
	return { kind: "unsupported", what: what ?? "message" };
}

/** `/name@bot args` → command; anything else is text. */
export function classifyText(text: string): Classified {
	const match = /^\/([A-Za-z0-9_]{1,32})(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/.exec(text.trim());
	if (match === null) return { kind: "text", text };
	return { kind: "command", name: (match[1] ?? "").toLowerCase(), args: (match[2] ?? "").trim() };
}
