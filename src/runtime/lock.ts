import { closeSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { processStartTime } from "./proc-start.ts";

export type LockOwner = { pid: number; startTime?: string; host: string; startedAt: string };

export class LockHeld extends Error {
	readonly owner: LockOwner | undefined;
	constructor(owner: LockOwner | undefined, reason: string) {
		super(reason);
		this.name = "LockHeld";
		this.owner = owner;
	}
}

export interface DataDirLock {
	readonly path: string;
	release(): void;
}

export type LockProbe = {
	readonly pid: number;
	readonly host: string;
	/** `process.kill(pid, 0)`: throws ESRCH for a dead pid, EPERM for a pid of another user. */
	readonly signal: (pid: number) => void;
	readonly startTime: (pid: number) => string | undefined;
	readonly now: () => number;
};

const defaultProbe = (): LockProbe => ({
	pid: process.pid,
	host: hostname(),
	signal: (pid) => process.kill(pid, 0),
	startTime: processStartTime,
	now: Date.now,
});

const GARBAGE_GRACE_MS = 10_000;

/**
 * Take the single-owner lock of a data directory: `owner.lock` created exclusively. A lock whose owner is dead (or
 * whose pid was reused by another process on Linux) is taken over once; a live owner, an owner on another host or
 * of another user means refusal with `LockHeld`.
 */
export function acquireDataDirLock(dir: string, probe: LockProbe = defaultProbe()): DataDirLock {
	const path = join(dir, "owner.lock");
	const owner: LockOwner = {
		pid: probe.pid,
		host: probe.host,
		startedAt: new Date(probe.now()).toISOString(),
		...optionalStart(probe.startTime(probe.pid)),
	};
	if (!tryCreate(path, owner)) {
		const reason = takeoverRefusal(path, probe);
		if (reason !== undefined) throw new LockHeld(readOwner(path), reason);
		unlinkQuiet(path);
		if (!tryCreate(path, owner)) throw new LockHeld(readOwner(path), "another process took the lock first");
	}
	return { path, release: () => releaseIfOurs(path, probe.pid) };
}

function optionalStart(startTime: string | undefined): { startTime?: string } {
	return startTime === undefined ? {} : { startTime };
}

function tryCreate(path: string, owner: LockOwner): boolean {
	let fd: number;
	try {
		fd = openSync(path, "wx", 0o600);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
		throw error;
	}
	try {
		writeSync(fd, `${JSON.stringify(owner)}\n`);
	} finally {
		closeSync(fd);
	}
	return true;
}

function readOwner(path: string): LockOwner | undefined {
	try {
		const value = JSON.parse(readFileSync(path, "utf8")) as Partial<LockOwner>;
		return typeof value.pid === "number" && typeof value.host === "string" ? (value as LockOwner) : undefined;
	} catch {
		return undefined;
	}
}

/** Why the existing lock must be respected, or undefined when it is stale and may be taken over. */
function takeoverRefusal(path: string, probe: LockProbe): string | undefined {
	const owner = readOwner(path);
	if (owner === undefined) return garbageRefusal(path, probe);
	if (owner.host !== probe.host) return `DATA_DIR is locked by pid ${owner.pid} on host ${owner.host}`;
	const alive = isAlive(owner.pid, probe);
	if (alive === "other_user") return `DATA_DIR is used by pid ${owner.pid} of another user (since ${owner.startedAt})`;
	if (alive === "dead") return undefined;
	if (owner.startTime !== undefined && probe.startTime(owner.pid) !== owner.startTime) return undefined;
	return `DATA_DIR is used by pid ${owner.pid} (since ${owner.startedAt})`;
}

function garbageRefusal(path: string, probe: LockProbe): string | undefined {
	try {
		const age = probe.now() - statSync(path).mtimeMs;
		return age > GARBAGE_GRACE_MS ? undefined : "DATA_DIR lock file is being written by another process";
	} catch {
		return undefined;
	}
}

function isAlive(pid: number, probe: LockProbe): "alive" | "dead" | "other_user" {
	try {
		probe.signal(pid);
		return "alive";
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		return code === "EPERM" ? "other_user" : "dead";
	}
}

function unlinkQuiet(path: string): void {
	try {
		unlinkSync(path);
	} catch {
		// Already gone.
	}
}

function releaseIfOurs(path: string, pid: number): void {
	if (readOwner(path)?.pid === pid) unlinkQuiet(path);
}
