import assert from "node:assert/strict";
import { test } from "node:test";
import fc from "fast-check";
import { parseList } from "../../src/config/schema.ts";
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
