import type { JsonValue } from "@earendil-works/chord";
import type { Harness, ModelRef } from "@earendil-works/pi-durable";
import type { FatalHandler } from "../runtime/fatal.ts";
import type { Logger } from "../runtime/log.ts";
import type { TelegramPort } from "../telegram/port.ts";

export type DeliverInput = {
	chatId: number;
	/** The user's Telegram message; the answer replies to it. */
	messageId: number;
	/** Durable request id of the submission: `tg:<chat>:<message>`. */
	requestId: string;
	/** pi-ai `UserInput`. */
	content: JsonValue;
};

export type Preview = { messageId: number };

export type Outcome =
	| { kind: "answer"; entryId: number }
	| { kind: "unanswered"; reason: string; detail?: string }
	| { kind: "shared"; entryId: number };

export type WaitState = { phase: "wait"; submissionId?: number; preview?: Preview };

export type SendState = {
	phase: "send";
	outcome: Outcome;
	preview?: Preview;
	/** Chunks delivered (or given up on) so far. */
	sent: number;
	/** Index of a non-idempotent send started but not recorded: its outcome is unknown after a crash. */
	inFlight?: number;
	messageIds: number[];
	/** Some chunk's outcome is unknown. */
	unknown?: boolean;
};

export type DeliverState = WaitState | SendState;

/** What delivery needs from the running channel; getters, because tasks are defined before the Harness opens. */
export type DeliveryDeps = {
	readonly port: () => TelegramPort;
	readonly harness: () => Harness;
	readonly log: Logger;
	readonly model: ModelRef;
	readonly onFatal: FatalHandler;
	readonly previewIntervalMs?: number;
};
