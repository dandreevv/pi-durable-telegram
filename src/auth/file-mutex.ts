import { open, stat, unlink } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

export type FileMutexOptions = {
	readonly retryMs?: number;
	readonly timeoutMs?: number;
	/** A lock file older than this (by mtime) belongs to a crashed process and is removed. */
	readonly staleMs?: number;
	readonly signal?: AbortSignal;
};

/** Cross-process mutual exclusion through an exclusively created lock file. */
export async function withFileMutex<T>(path: string, fn: () => Promise<T>, options: FileMutexOptions = {}): Promise<T> {
	await acquire(path, options);
	try {
		return await fn();
	} finally {
		await unlink(path).catch(() => undefined);
	}
}

async function acquire(path: string, options: FileMutexOptions): Promise<void> {
	const deadline = Date.now() + (options.timeoutMs ?? 10_000);
	for (;;) {
		options.signal?.throwIfAborted();
		if (await tryCreate(path)) return;
		await removeIfStale(path, options.staleMs ?? 60_000);
		if (Date.now() >= deadline) throw new Error(`Timed out waiting for lock ${path}`);
		await sleep(options.retryMs ?? 50);
	}
}

async function tryCreate(path: string): Promise<boolean> {
	try {
		const handle = await open(path, "wx", 0o600);
		await handle.writeFile(String(process.pid));
		await handle.close();
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
		throw error;
	}
}

async function removeIfStale(path: string, staleMs: number): Promise<void> {
	const info = await stat(path).catch(() => undefined);
	if (info !== undefined && Date.now() - info.mtimeMs > staleMs) await unlink(path).catch(() => undefined);
}
