import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { type FauxProviderHandle, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { splitForTelegram } from "../../src/format/chunk.ts";
import { stripButtons, THINKING } from "../../src/format/rich.ts";
import { TelegramApiError } from "../../src/telegram/errors.ts";
import { CHAT, newFaux, startTestAgent, type TestAgent, tempDir } from "../helpers/agent.ts";
import { waitFor } from "../helpers/env.ts";
import { FakeTelegram } from "../helpers/fake-telegram.ts";
import { lastUserText, observe, words } from "../helpers/faux-steps.ts";
import { callbackUpdate, textUpdate } from "../helpers/updates.ts";

const RICH = { TELEGRAM_RICH: "auto" };
const QUESTION = `| a | b |\n|---|---|\n| 1 | 2 |\n\nUpdate now?\n\n<tg-button-row><tg-button type="callback_data" data="Да, обновляй">Да</tg-button><tg-button type="callback_data" data="Нет">Нет</tg-button></tg-button-row>`;

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup(
	faux: FauxProviderHandle,
	port = new FakeTelegram(),
): Promise<{ t: TestAgent; port: FakeTelegram }> {
	const { dir, cleanup } = await tempDir();
	const t = await startTestAgent({ dir, faux, port, config: RICH });
	cleanups.push(cleanup, () => t.close());
	return { t, port };
}

const delivered = (t: TestAgent) =>
	waitFor(() => t.logs.some((line) => line.includes("info delivered")), { what: "delivered" });

test("T-rich-answer: streamed as a native draft, delivered as one rich message that replies to the user", async () => {
	const faux = newFaux({ tokensPerSecond: 150 });
	const answer = `${words(120)}\n\n${QUESTION}`;
	faux.setResponses([fauxAssistantMessage(answer)]);
	const { t, port } = await setup(faux);
	await t.agent.channel.handleUpdate(textUpdate(CHAT, 10, "do it"));
	await delivered(t);
	assert.equal(port.drafts[0]?.markdown, THINKING, "a run starts with the thinking draft");
	assert.ok(
		port.drafts.some((draft) => draft.markdown.startsWith("word0")),
		"the answer streamed into the draft",
	);
	assert.ok(port.drafts.every((draft) => !draft.markdown.includes("<tg-button") && draft.draftId > 0));
	assert.deepEqual(
		port.created(CHAT).map((m) => [m.text, m.rich, m.replyTo]),
		[[answer, true, 10]],
	);
	assert.equal(port.count("editMessageText"), 0, "no edited preview");
});

test("T-rich-400: Telegram refuses the rich message, the answer goes out as HTML with buttons as labels", async () => {
	const faux = newFaux();
	faux.setResponses([fauxAssistantMessage(QUESTION)]);
	const port = new FakeTelegram();
	port.use((call) => {
		if (call.options?.rich === true) throw new TelegramApiError("sendRichMessage", 400, "Bad Request: RICH_INVALID");
	});
	const { t } = await setup(faux, port);
	await t.agent.channel.handleUpdate(textUpdate(CHAT, 11, "go"));
	await delivered(t);
	const html = splitForTelegram(stripButtons(QUESTION)).map((chunk) => chunk.html);
	assert.deepEqual(
		port.created(CHAT).map((m) => [m.text, m.html, m.replyTo]),
		html.map((text, i) => [text, true, i === 0 ? 11 : undefined]),
	);
	assert.match(html[0] ?? "", /\[Да\] \[Нет\]$/);
	assert.ok(t.logs.some((line) => line.includes("rich_rejected")));
});

test("T-draft-fallback: refused drafts switch the run to an edited preview; the final answer edits it", async () => {
	const faux = newFaux({ tokensPerSecond: 150 });
	const answer = `Done: ${words(200)}`;
	faux.setResponses([fauxAssistantMessage(answer)]);
	const port = new FakeTelegram();
	port.use((call) => {
		if (call.method === "sendDraft")
			throw new TelegramApiError("sendRichMessageDraft", 400, "Bad Request: not private");
	});
	const { t } = await setup(faux, port);
	await t.agent.channel.handleUpdate(textUpdate(CHAT, 12, "go"));
	await delivered(t);
	assert.equal(port.count("sendDraft"), 1, "only the first draft was tried");
	assert.ok(port.count("editMessageText") >= 2, "streamed by edits");
	assert.deepEqual(
		port.created(CHAT).map((m) => [m.text, m.rich, m.replyTo]),
		[[answer, true, 12]],
	);
});

test("T-rich-crash: closed while the draft streams, reopened: the run resumes and the answer lands once", async () => {
	const { dir, cleanup } = await tempDir();
	cleanups.push(cleanup);
	const port = new FakeTelegram();
	const slow = newFaux({ tokensPerSecond: 40 });
	slow.setResponses([fauxAssistantMessage(`Partial ${words(600)}`)]);
	const first = await startTestAgent({ dir, faux: slow, port, config: RICH });
	await first.agent.channel.handleUpdate(textUpdate(CHAT, 1, "work"));
	await waitFor(() => port.drafts.some((draft) => draft.markdown.startsWith("Partial")), {
		what: "draft",
		timeoutMs: 15_000,
	});
	await first.close();
	const draftId = port.drafts[0]?.draftId;
	const fast = newFaux();
	fast.setResponses([fauxAssistantMessage("Final answer after restart")]);
	const second = await startTestAgent({ dir, faux: fast, port, config: RICH });
	cleanups.push(() => second.close());
	await delivered(second);
	assert.deepEqual(
		port.created(CHAT).map((m) => [m.text, m.rich, m.replyTo]),
		[["Final answer after restart", true, 1]],
	);
	assert.equal(fast.state.callCount, 1, "the interrupted request was resent once");
	assert.ok(
		port.drafts.every((draft) => draft.draftId === draftId),
		"the resumed run keeps its draft id",
	);
});

test("T-tap: a tap is answered, admitted once as the user's reply with its context, and marks the choice", async () => {
	const faux = newFaux();
	const seen: string[] = [];
	faux.setResponses([
		fauxAssistantMessage(QUESTION),
		observe((messages) => void seen.push(lastUserText(messages)), fauxAssistantMessage("Updating.")),
	]);
	const { t, port } = await setup(faux);
	await t.agent.channel.handleUpdate(textUpdate(CHAT, 20, "update?"));
	const question = await waitFor(() => port.created(CHAT)[0], { what: "question" });
	const tap = callbackUpdate(CHAT, question.id, "Да, обновляй", { queryId: "cq-1" });
	await t.agent.channel.handleUpdate(tap);
	await waitFor(() => port.textsIn(CHAT).includes("Updating."), { what: "answer to the tap" });
	assert.deepEqual(port.answeredQueries, ["cq-1"]);
	assert.equal(
		seen[0],
		"Да, обновляй\n\n(button under your message: «| a | b | |---|---| | 1 | 2 | Update now? [Да] [Нет]»)",
	);
	assert.equal(port.created(CHAT).find((m) => m.text === "Updating.")?.replyTo, question.id);
	await waitFor(() => port.messages.get(question.id)?.text.includes("✅ Да"), { what: "choice marked" });
	assert.match(port.messages.get(question.id)?.text ?? "", /<tg-button type="disabled">Нет<\/tg-button>/);
	await t.agent.channel.handleUpdate(tap);
	await waitFor(() => t.logs.filter((line) => line.includes("update_duplicate")).length === 1, { what: "duplicate" });
	assert.equal(faux.state.callCount, 2, "the redelivered tap reached the model once");
});

test("T-tap-stranger: taps from strangers or another sender are ignored silently and never reach the model", async () => {
	const faux = newFaux();
	const { t, port } = await setup(faux);
	await t.agent.channel.handleUpdate(callbackUpdate(222, 5, "Да"));
	await t.agent.channel.handleUpdate(callbackUpdate(CHAT, 5, "Да", { fromId: 333 }));
	assert.equal(port.calls.filter((call) => call.method !== "setMyCommands").length, 0, "no Telegram call at all");
	assert.equal(faux.state.callCount, 0);
	assert.equal(t.logs.filter((line) => line.includes("update_ignored")).length, 2);
});

test("T-tap-old: a button of a message the bridge no longer knows still becomes a message, unmarked", async () => {
	const faux = newFaux();
	const seen: string[] = [];
	faux.setResponses([observe((messages) => void seen.push(lastUserText(messages)), fauxAssistantMessage("ok"))]);
	const { t, port } = await setup(faux);
	await t.agent.channel.handleUpdate(callbackUpdate(CHAT, 77, "Нет", { text: "Old question?" }));
	await waitFor(() => port.textsIn(CHAT).includes("ok"), { what: "answer" });
	assert.equal(seen[0], "Нет\n\n(button under your message: «Old question?»)");
	assert.equal(port.count("editMessageText"), 0);
});
