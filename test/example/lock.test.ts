import assert from "node:assert/strict";
import { existsSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { acquireDataDirLock, LockHeld, type LockProbe } from "../../src/runtime/lock.ts";
import { tempDir } from "../helpers/agent.ts";

function probe(over: Partial<LockProbe> = {}): LockProbe {
	return { pid: 100, host: "h1", signal: () => undefined, startTime: () => "s100", now: Date.now, ...over };
}

const dead = () => {
	throw Object.assign(new Error("no such process"), { code: "ESRCH" });
};
const otherUser = () => {
	throw Object.assign(new Error("not permitted"), { code: "EPERM" });
};

test("lock: create, refuse a live owner, release only our own", async () => {
	const { dir, cleanup } = await tempDir();
	try {
		const lock = acquireDataDirLock(dir, probe());
		assert.equal(JSON.parse(readFileSync(lock.path, "utf8")).pid, 100);
		assert.throws(
			() => acquireDataDirLock(dir, probe({ pid: 200, startTime: (pid) => (pid === 100 ? "s100" : "s200") })),
			(error: unknown) => {
				assert.ok(error instanceof LockHeld);
				assert.match(error.message, /pid 100/);
				return true;
			},
		);
		lock.release();
		assert.equal(existsSync(lock.path), false);
	} finally {
		await cleanup();
	}
});

test("lock: a dead owner, a reused pid and an old garbage file are taken over", async () => {
	const { dir, cleanup } = await tempDir();
	try {
		acquireDataDirLock(dir, probe());
		const second = acquireDataDirLock(dir, probe({ pid: 200, signal: dead }));
		assert.equal(JSON.parse(readFileSync(second.path, "utf8")).pid, 200);
		// pid 200 alive, but with another start time: the pid was reused.
		const third = acquireDataDirLock(
			dir,
			probe({ pid: 300, startTime: (pid) => (pid === 200 ? "different" : "s300") }),
		);
		assert.equal(JSON.parse(readFileSync(third.path, "utf8")).pid, 300);
		writeFileSync(third.path, "garbage");
		assert.throws(() => acquireDataDirLock(dir, probe({ pid: 400 })), LockHeld);
		const old = (Date.now() - 60_000) / 1000;
		utimesSync(third.path, old, old);
		const fourth = acquireDataDirLock(dir, probe({ pid: 400 }));
		assert.equal(JSON.parse(readFileSync(fourth.path, "utf8")).pid, 400);
	} finally {
		await cleanup();
	}
});

test("lock: another user's process and another host are refused", async () => {
	const { dir, cleanup } = await tempDir();
	try {
		acquireDataDirLock(dir, probe());
		assert.throws(() => acquireDataDirLock(dir, probe({ pid: 200, signal: otherUser })), /another user/);
		assert.throws(() => acquireDataDirLock(dir, probe({ pid: 200, host: "h2", signal: dead })), /host h1/);
		assert.ok(existsSync(join(dir, "owner.lock")));
	} finally {
		await cleanup();
	}
});
