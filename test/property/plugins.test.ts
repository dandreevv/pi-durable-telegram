import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import { parseList } from "../../src/config/schema.ts";
import { parseFrontmatter } from "../../src/plugins/skills.ts";
import { check } from "../helpers/property.ts";

const piece = fc.string({ unit: fc.constantFrom(..."ab ,./~@-_".split("")), maxLength: 8 });

test("P-plugin-list: items are trimmed, unique, non-empty, in first-appearance order; parsing is idempotent", (t) => {
	check(t, fc.array(piece, { maxLength: 10 }), (pieces) => {
		const raw = pieces.join(",");
		const items = parseList(raw);
		assert.ok(items.every((item) => item !== "" && item === item.trim() && !item.includes(",")));
		assert.equal(new Set(items).size, items.length);
		assert.deepEqual(parseList(items.join(",")), items);
		const expected = [
			...new Set(
				raw
					.split(",")
					.map((item) => item.trim())
					.filter(Boolean),
			),
		];
		assert.deepEqual(items, expected);
		return true;
	});
});

const text = fc
	.array(fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9.,()-]{0,7}$/), { minLength: 1, maxLength: 6 })
	.map((words) => words.join(" "));
const writers: ((value: string) => string)[] = [
	(value) => ` ${value}`,
	(value) => ` "${value}"`,
	(value) => ` '${value}'`,
	(value) => ` >\n  ${value.split(" ").join("\n  ")}`,
	(value) => ` |\n  ${value}`,
];

test("P-frontmatter: name and description survive plain, quoted and block styles; other keys are ignored", (t) => {
	check(
		t,
		fc.tuple(text, text, fc.nat(writers.length - 1), fc.nat(writers.length - 1)),
		([name, description, nameStyle, descriptionStyle]) => {
			const write = (i: number, value: string) => (writers[i] as (value: string) => string)(value);
			const doc = `---\nlicense: MIT\nname:${write(nameStyle, name)}\nmetadata:\n  name: nested\ndescription:${write(descriptionStyle, description)}\n---\n# Body\nname: not this\n`;
			const parsed = parseFrontmatter(doc);
			assert.equal(parsed.name, name);
			assert.equal(parsed.description, description);
			return true;
		},
	);
});

test("P-frontmatter-total: arbitrary text never throws and yields strings or nothing", (t) => {
	check(t, fc.string({ maxLength: 300 }), (raw) => {
		for (const input of [raw, `---\n${raw}`, `---\n${raw}\n---\n`]) {
			const parsed = parseFrontmatter(input);
			for (const value of Object.values(parsed)) assert.equal(typeof value, "string");
		}
		return true;
	});
});
