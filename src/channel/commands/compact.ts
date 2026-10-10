import { BACKGROUND_CONTEXT as BG } from "@earendil-works/chord/context";
import { INTAKE_RING_SIZE, Intake, pushRing } from "../docs.ts";
import { type MessageScope, reply } from "../scope.ts";

/** /compact [instructions]: start a manual compaction and a durable task that reports its outcome. */
export async function runCompact(scope: MessageScope, instructions: string): Promise<void> {
	const { conversation, rt } = scope;
	const compactionTaskId = await conversation.compact(instructions === "" ? undefined : instructions, BG);
	const recorded = await conversation.commit(async (tx) => {
		if (!pushRing((await tx.doc(Intake, conversation.id)).keys, scope.key, INTAKE_RING_SIZE)) return false;
		const input = { chatId: scope.chatId, replyTo: scope.messageId, compactionTaskId };
		await tx.createTask(rt.compactReport, input, { ownership: { kind: "conversation" }, background: true });
		return true;
	}, BG);
	if (recorded) await reply(scope, "Compacting…");
}
