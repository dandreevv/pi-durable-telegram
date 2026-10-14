import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import { fenceStateAfter } from "../../src/format/fence.ts";
import { draftMarkdown, markChosen, shortenButtonsData, splitRich, stripButtons } from "../../src/format/rich.ts";
import { check } from "../helpers/property.ts";

const button = (data: string, label = "L") => `<tg-button type="callback_data" data="${data}">${label}</tg-button>`;
const dataOf = (markdown: string) => [...markdown.matchAll(/\sdata="([^"]*)"/g)].map((match) => match[1] ?? "");
const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const dataText = fc.string({
	unit: fc.constantFrom("a", "Я", "😀", "&amp;", " ", "#", "2"),
	minLength: 1,
	maxLength: 60,
});

test("P-button-data: every data fits 64 bytes, short data is untouched, cuts keep characters whole", (t) => {
	check(t, fc.array(dataText, { minLength: 1, maxLength: 6 }), (datas) => {
		const markdown = `Pick one\n\n<tg-button-row>${datas.map((d) => button(d)).join("")}</tg-button-row>`;
		const out = dataOf(shortenButtonsData(markdown));
		assert.equal(shortenButtonsData(markdown), shortenButtonsData(markdown), "deterministic");
		out.forEach((short, i) => {
			const original = datas[i] ?? "";
			assert.ok(Buffer.byteLength(short) <= 64 && short !== "");
			assert.ok(!loneSurrogate.test(short) && !/&[a-z#0-9]*$/i.test(short.replace(/#\d+$/, "")));
			if (Buffer.byteLength(original) <= 64) assert.equal(short, original);
		});
		return true;
	});
});

test("P-button-data: long data that differ stay different after the cut", (t) => {
	const long = dataText.map((d) => `${"Расскажи подробнее про ".repeat(3)}${d}`);
	check(t, fc.uniqueArray(long, { minLength: 2, maxLength: 5 }), (datas) => {
		const out = dataOf(shortenButtonsData(datas.map((d) => button(d)).join("\n")));
		assert.equal(new Set(out).size, datas.length);
		return true;
	});
});

test("P-button-data: a cut never repeats another button's data, wherever the short one stands", (t) => {
	const mixed = fc.oneof(
		dataText,
		dataText.map((d) => `${"a".repeat(64)}${d}`),
		fc.constant("a".repeat(64)),
	);
	check(t, fc.uniqueArray(mixed, { minLength: 2, maxLength: 5 }), (datas) => {
		const out = dataOf(shortenButtonsData(datas.map((d) => button(d)).join("\n")));
		assert.equal(new Set(out).size, datas.length);
		return true;
	});
});

test("P-button-data: empty data takes the label, so no callback data is empty", () => {
	assert.deepEqual(dataOf(shortenButtonsData(`${button("", "Да")}${button("", " ")}`)), ["Да", "?"]);
});

const line = fc.oneof(
	fc.constantFrom(
		"",
		"",
		"A paragraph line.",
		"```ts",
		"```",
		"~~~",
		"<details><summary>More</summary>",
		"</details>",
		"| a | b |",
		"|---|---|",
		"- [ ] task",
		`<tg-button-row>${button("Да")}${button("Нет")}</tg-button-row>`,
	),
	fc.integer({ min: 1, max: 900 }).map((n) => "y".repeat(n)),
	fc.integer({ min: 1, max: 300 }).map((n) => "😀".repeat(n)),
);
const fenceLine = /^ {0,3}(`{3,}|~{3,})/;
const content = (text: string) =>
	text
		.split("\n")
		.filter((each) => !fenceLine.test(each))
		.join("")
		.replace(/\s+/g, "");
const blocksOf = (chunk: string) => {
	let fence: ReturnType<typeof fenceStateAfter>;
	let blocks = 0;
	for (const each of chunk.split("\n")) {
		if (fence === undefined && each.trim() !== "") blocks += 1;
		fence = fenceStateAfter(each, fence);
	}
	return blocks;
};

test("P-rich-split: chunks stay within the limits, keep every character, and close the fences they cut", (t) => {
	const limits = { chars: 600, blocks: 12 };
	check(t, fc.array(line, { maxLength: 120 }), (lines) => {
		const markdown = lines.join("\n");
		const chunks = splitRich(markdown, limits);
		for (const chunk of chunks) {
			assert.ok(chunk.length <= limits.chars, `chunk of ${chunk.length} chars`);
			assert.ok(blocksOf(chunk) <= limits.blocks, `chunk of ${blocksOf(chunk)} blocks`);
			assert.ok(!loneSurrogate.test(chunk));
		}
		for (const chunk of chunks.slice(0, -1)) assert.equal(fenceStateAfter(chunk, undefined), undefined);
		assert.equal(content(chunks.join("\n")), content(markdown));
		return true;
	});
});

test("rich split: blocks are never cut inside a fold or a button row; short text is one message", () => {
	const fold = `<details><summary>Log</summary>\n\n${"line\n\n".repeat(8)}</details>`;
	const row = `<tg-button-row>\n${button("a")}\n\n${button("b")}\n</tg-button-row>`;
	const chunks = splitRich(`intro\n\n${fold}\n\n${row}`, { chars: 200, blocks: 40 });
	assert.equal(chunks.length, 2);
	assert.ok(chunks[0]?.includes("<details>") && chunks[0].endsWith("</details>"));
	assert.ok(chunks[1]?.startsWith("<tg-button-row>") && chunks[1].endsWith("</tg-button-row>"));
	assert.deepEqual(splitRich("**Hi**\n\n| a |\n|---|"), ["**Hi**\n\n| a |\n|---|"]);
});

test("buttons: chosen marking, labels for the HTML fallback, draft frames", () => {
	const markdown = `Update now?\n\n<tg-button-row>${button("Да, обновляй", "Да")}${button("Нет &amp; потом", "Нет")}<tg-button type="url" url="https://x.y">Docs</tg-button></tg-button-row>`;
	const marked = markChosen(markdown, "Нет & потом") ?? "";
	assert.match(marked, /<tg-button type="disabled">Да<\/tg-button>/);
	assert.match(marked, /<tg-button type="disabled" style="success">✅ Нет<\/tg-button>/);
	assert.match(marked, /type="url"/, "other buttons stay");
	assert.equal(markChosen(marked, "Да, обновляй"), undefined, "nothing left to choose");
	assert.equal(markChosen(markdown, "something else"), undefined);
	assert.equal(stripButtons(markdown), "Update now?\n\n[Да] [Нет] [Docs]");
	assert.equal(draftMarkdown(""), "<tg-thinking>Thinking…</tg-thinking>");
	assert.equal(draftMarkdown("Partial <tg-butt"), "Partial");
});
