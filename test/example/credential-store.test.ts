import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import type { Credential } from "@earendil-works/pi-ai";
import { FileCredentialStore } from "../../src/auth/credential-store.ts";
import { tempDir } from "../helpers/agent.ts";

const oauth = (n: number): Credential => ({
	type: "oauth",
	access: `access-${n}`,
	refresh: `refresh-${n}`,
	expires: n,
});

test("credential store: mode 600, atomic writes, list without secrets, delete", async () => {
	const { dir, cleanup } = await tempDir();
	try {
		const path = join(dir, "data", "auth.json");
		const store = new FileCredentialStore(path);
		assert.equal(await store.read("anthropic"), undefined);
		await store.modify("anthropic", async () => oauth(1));
		assert.equal(statSync(path).mode & 0o777, 0o600);
		assert.equal(statSync(join(dir, "data")).mode & 0o777, 0o700);
		assert.deepEqual(await store.read("anthropic"), oauth(1));
		assert.deepEqual(await store.list(), [{ providerId: "anthropic", type: "oauth" }]);
		assert.equal(
			await store.modify("anthropic", async () => undefined).then((c) => (c as { access: string }).access),
			"access-1",
		);
		await store.delete("anthropic");
		assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), {});
	} finally {
		await cleanup();
	}
});

test("credential store: reads see another process's write; concurrent modifies serialize", async () => {
	const { dir, cleanup } = await tempDir();
	try {
		const path = join(dir, "auth.json");
		const a = new FileCredentialStore(path);
		const b = new FileCredentialStore(path);
		await a.modify("anthropic", async () => oauth(1));
		await b.modify("anthropic", async () => oauth(2));
		assert.deepEqual(await a.read("anthropic"), oauth(2));
		let counter = 0;
		const bump = (store: FileCredentialStore) =>
			store.modify("counter", async (current) => {
				const value = current?.type === "api_key" ? Number(current.key) : 0;
				await new Promise((resolve) => setTimeout(resolve, 2));
				counter += 1;
				return { type: "api_key", key: String(value + 1) };
			});
		await Promise.all(Array.from({ length: 20 }, (_, i) => bump(i % 2 === 0 ? a : b)));
		assert.equal(counter, 20);
		assert.deepEqual(await a.read("counter"), { type: "api_key", key: "20" });
	} finally {
		await cleanup();
	}
});

test("credential store: corrupt files are reported without their contents", async () => {
	const { dir, cleanup } = await tempDir();
	try {
		const path = join(dir, "auth.json");
		await writeFile(path, '{"anthropic": {"refresh": "sk-ant-secret-value"');
		await assert.rejects(new FileCredentialStore(path).read("anthropic"), (error: Error) => {
			assert.ok(!error.message.includes("secret"));
			return true;
		});
	} finally {
		await cleanup();
	}
});

test("credential store: the file mutex excludes another process", async () => {
	const { dir, cleanup } = await tempDir();
	try {
		const path = join(dir, "auth.json");
		const child = spawn(process.execPath, [join(import.meta.dirname, "../fixtures/credential-writer.ts"), path, "30"], {
			stdio: "inherit",
		});
		const store = new FileCredentialStore(path);
		for (let i = 0; i < 30; i++) {
			await store.modify("count", async (current) => ({
				type: "api_key",
				key: String(Number(current?.type === "api_key" ? current.key : 0) + 1),
			}));
		}
		const code = await new Promise<number | null>((resolve) => child.on("exit", resolve));
		assert.equal(code, 0);
		assert.deepEqual(await store.read("count"), { type: "api_key", key: "60" });
	} finally {
		await cleanup();
	}
});
