import { BACKGROUND_CONTEXT as BG } from "@earendil-works/chord/context";
import { recordKey } from "../intake.ts";
import { type MessageScope, reply } from "../scope.ts";

export const NEW_REPLY = "New context. Old history is kept.";

/**
 * /new: abort the current work and queued inputs, then reset the same conversation; the old transcript stays in
 * storage. Delivery tasks are background work, so they survive and report `aborted`.
 */
export async function runNew(scope: MessageScope): Promise<void> {
	if (!(await recordKey(scope.conversation, scope.key, BG))) return;
	await scope.conversation.abort(BG);
	await scope.conversation.reset(undefined, BG);
	await reply(scope, NEW_REPLY);
}
