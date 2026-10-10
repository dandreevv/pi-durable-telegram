import assert from "node:assert/strict";
import { test } from "node:test";
import type { Update } from "grammy/types";
import { checkAccess } from "../../src/channel/access.ts";
import { classifyMessage, classifyText } from "../../src/channel/classify.ts";
import { textUpdate } from "../helpers/updates.ts";

const allowed = new Set([111]);

test("allowed private message passes", () => {
	const decision = checkAccess(textUpdate(111, 1, "hi"), allowed);
	assert.deepEqual(decision, { allowed: true, chatId: 111, userId: 111 });
});

test("strangers, groups, bots, foreign senders and non-messages are denied without text in the log fields", () => {
	const cases: [Update, string][] = [
		[textUpdate(222, 1, "secret text"), "not_allowed"],
		[textUpdate(-100, 1, "secret text", { fromId: 111, chatType: "group" }), "not_private"],
		[textUpdate(111, 1, "secret text", { isBot: true }), "bot_sender"],
		[textUpdate(111, 1, "secret text", { fromId: 333 }), "sender_not_chat"],
		[
			{
				update_id: 9,
				channel_post: { message_id: 1, date: 1, chat: { id: -5, type: "channel", title: "c" }, text: "secret text" },
			} as Update,
			"not_a_message",
		],
		[
			{
				update_id: 10,
				edited_message: {
					message_id: 1,
					date: 1,
					edit_date: 2,
					chat: { id: 111, type: "private", first_name: "u" },
					from: { id: 111, is_bot: false, first_name: "u" },
					text: "secret text",
				},
			} as Update,
			"not_a_message",
		],
	];
	for (const [update, reason] of cases) {
		const decision = checkAccess(update, allowed);
		assert.equal(decision.allowed, false);
		if (decision.allowed) continue;
		assert.equal(decision.reason, reason);
		assert.ok(!JSON.stringify(decision.fields).includes("secret"));
	}
});

test("message classification", () => {
	assert.deepEqual(classifyText("/new"), { kind: "command", name: "new", args: "" });
	assert.deepEqual(classifyText("/compact@my_bot keep the API notes"), {
		kind: "command",
		name: "compact",
		args: "keep the API notes",
	});
	assert.deepEqual(classifyText("/STATUS"), { kind: "command", name: "status", args: "" });
	assert.deepEqual(classifyText("a /new in text"), { kind: "text", text: "a /new in text" });
	assert.deepEqual(classifyText("/path/to/file"), { kind: "text", text: "/path/to/file" });
	const base = { message_id: 1, date: 1, chat: { id: 1, type: "private" as const, first_name: "u" } };
	assert.deepEqual(classifyMessage({ ...base, sticker: {} } as never), { kind: "unsupported", what: "sticker" });
	assert.deepEqual(classifyMessage({ ...base, voice: {} } as never), { kind: "voice" });
	assert.deepEqual(classifyMessage({ ...base, video_note: {} } as never), { kind: "voice" });
	assert.deepEqual(classifyMessage({ ...base, document: {} } as never), { kind: "document" });
});
