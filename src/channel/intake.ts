import type { Context } from "@earendil-works/chord";
import type { Conversation, Harness } from "@earendil-works/pi-durable";
import type { DeliverTask } from "../delivery/task.ts";
import type { DeliverInput } from "../delivery/types.ts";
import { INTAKE_RING_SIZE, Intake, pushRing } from "./docs.ts";

/** Read-only check before any download or transcription: was this message already admitted? */
export async function isKnown(
	harness: Harness,
	conversation: Conversation,
	key: string,
	context: Context,
): Promise<boolean> {
	const intake = await harness.snapshot(Intake, conversation.id, context);
	return intake?.keys.includes(key) === true;
}

/** Record `key` in the intake ring; false when it was already there (a redelivered update). */
export function recordKey(conversation: Conversation, key: string, context: Context): Promise<boolean> {
	return conversation.commit(
		async (tx) => pushRing((await tx.doc(Intake, conversation.id)).keys, key, INTAKE_RING_SIZE),
		context,
	);
}

/**
 * Admit a message atomically: record its key and create its delivery task in one commit, so a redelivered update can
 * neither double-submit nor slip in before the task has submitted.
 */
export function admit(
	conversation: Conversation,
	deliver: DeliverTask,
	input: DeliverInput,
	context: Context,
): Promise<"admitted" | "duplicate"> {
	return conversation.commit(async (tx) => {
		const intake = await tx.doc(Intake, conversation.id);
		if (!pushRing(intake.keys, input.requestId, INTAKE_RING_SIZE)) return "duplicate";
		await tx.createTask(deliver, input, { ownership: { kind: "conversation" }, background: true });
		return "admitted";
	}, context);
}
