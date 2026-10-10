import { readFile, stat } from "node:fs/promises";
import { defineExtension, type Extension, section } from "@earendil-works/pi-durable";

const MAX_INSTRUCTIONS_BYTES = 64 * 1024;

export function preambleText(workdir: string | undefined): string {
	return [
		"You are a personal coding agent. The user talks to you through a private Telegram chat.",
		`Your working directory is ${workdir ?? "the service's working directory"}. You have read, write, edit and bash tools with full access to it.`,
		"Files the user sends are saved under inbox/ in the working directory; the message tells you the path. View images with the read tool.",
		"Use the telegram_send_file tool to send a file from the workspace to the user.",
		"Answers are shown in Telegram: keep them compact, use simple Markdown (bold, italic, code, code blocks, links), no tables.",
		"A tool call interrupted by a restart may already have taken effect: check the current state before repeating it.",
	].join("\n");
}

type Cached = { mtimeMs: number; size: number; text: string };

/** Reads the instructions file per request, re-reading only when its mtime or size changed. */
export function createInstructionsReader(path: string): () => Promise<string> {
	let cached: Cached | undefined;
	return async () => {
		const info = await stat(path).catch(() => undefined);
		if (info === undefined || !info.isFile()) {
			cached = undefined;
			return wrap(path, "none");
		}
		if (cached?.mtimeMs !== info.mtimeMs || cached.size !== info.size) {
			cached = { mtimeMs: info.mtimeMs, size: info.size, text: await readCapped(path) };
		}
		return wrap(path, cached.text);
	};
}

async function readCapped(path: string): Promise<string> {
	const bytes = await readFile(path).catch(() => undefined);
	if (bytes === undefined) return "none (file unreadable)";
	if (bytes.length <= MAX_INSTRUCTIONS_BYTES) return bytes.toString("utf8");
	return `${bytes.subarray(0, MAX_INSTRUCTIONS_BYTES).toString("utf8")}\n[truncated: file is larger than 64 KB]`;
}

function wrap(path: string, body: string): string {
	return `<project_instructions path=${JSON.stringify(path)}>\n${body.trim()}\n</project_instructions>`;
}

/**
 * System prompt: a constant preamble and the project instructions file. The instructions section is always present
 * (a missing file renders "none"), so the prompt cache is not invalidated by a section appearing or disappearing.
 */
export function createPromptExtension(options: { instructionsPath: string }): Extension {
	const instructions = createInstructionsReader(options.instructionsPath);
	return defineExtension({
		name: "prompt",
		sections: [
			section("preamble", (input) => preambleText(input.agent.cwd ?? input.env?.cwd), { tag: false }),
			section("agents_md", () => instructions(), { tag: false }),
		],
	});
}
