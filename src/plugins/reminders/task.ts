import { defineDoc, defineTask, type NextTaskState, type TaskRuntime, type Tx } from "@earendil-works/pi-durable";
import { ChatInfo, INTAKE_RING_SIZE, Intake, pushRing } from "../../channel/docs.ts";
import { DELIVER_TASK, type DeliverTask } from "../../delivery/task.ts";
import { type Every, formatLocal, nextOccurrence } from "./time.ts";

/** One pending reminder; `tz` and `wall` are fixed when it is set, so later occurrences keep the user's local time. */
export type Reminder = { text: string; next: number; every?: Every; wall: string; tz: string; setAt: number };

/** Pending reminders of a chat's main conversation, by id: what `list` shows and `cancel` removes. */
export const Reminders = defineDoc<{ items: Record<string, Reminder> }>({
	kind: "tg.reminders",
	version: 1,
	scope: "conversation",
	history: "latest",
	fork: "initial",
	initial: () => ({ items: {} }),
});

type Input = { id: string; due: number };
type State = { phase: "wait"; due: number };
type Next = NextTaskState<State, null>;
const DONE: Next = { status: "terminal", outcome: { status: "completed", result: null } };
const LATE_MS = 2 * 60_000;

export function wakeNote(id: string, entry: Reminder, due: number, now: number): string {
	const late = now - due > LATE_MS ? `, was due ${formatLocal(due, entry.tz)}, late: the service was down` : "";
	return `[reminder ${id}, set ${formatLocal(entry.setAt, entry.tz)}${late}] ${entry.text}`;
}

/**
 * The wake input and the next due time commit together; a cancelled or already advanced entry fires nothing, and the
 * intake key `remind:<id>:<due>` (also the submission's request id) drops a second wake for the same due time.
 */
async function fire(tx: Tx, runtime: TaskRuntime<Input, State, null, object>, id: string, due: number): Promise<Next> {
	const doc = await tx.doc(Reminders, runtime.conversationId);
	const entry = Object.hasOwn(doc.items, id) ? doc.items[id] : undefined;
	if (entry === undefined || entry.next !== due) return DONE;
	if (runtime.registry.extension("reminders") === undefined) {
		delete doc.items[id];
		runtime.report(new Error(`reminder ${id} dropped: the reminders plugin is off`));
		return DONE;
	}
	const key = `remind:${id}:${due}`;
	if (pushRing((await tx.doc(Intake, runtime.conversationId)).keys, key, INTAKE_RING_SIZE)) {
		const chatId = (await tx.doc(ChatInfo, runtime.conversationId)).chatId;
		const deliver = runtime.registry.task(DELIVER_TASK) as unknown as DeliverTask;
		const content = wakeNote(id, entry, due, runtime.now());
		await tx.createTask(
			deliver,
			{ chatId, requestId: key, content },
			{ ownership: { kind: "conversation" }, background: true },
		);
	}
	const next = nextOccurrence(entry, due, runtime.now());
	if (next === undefined) {
		delete doc.items[id];
		return DONE;
	}
	entry.next = next;
	return { status: "running", checkpoint: { phase: "wait", due: next } };
}

/**
 * One background, conversation-owned task per reminder: it sleeps until the due time on the harness clock, and after a
 * restart sleeps again from its checkpoint (or fires at once, late). Registered by core whether or not the reminders
 * plugin is on, so unfinished reminders never block startup.
 */
export const ReminderTask = defineTask<Input, State, null>({
	name: "tg.remind",
	version: 1,
	initial: (input) => ({ phase: "wait", due: input.due }),
	phases: {
		wait: async (task, runtime, context) => {
			const due = task.state.checkpoint.due;
			await runtime.sleep(due, context);
			await runtime.commit((tx) => fire(tx, runtime, task.input.id, due), context);
		},
	},
	abort: (task, runtime, context) =>
		runtime.commit(async (tx) => {
			delete (await tx.doc(Reminders, runtime.conversationId)).items[task.input.id];
			return { status: "terminal", outcome: { status: "aborted" } };
		}, context),
});
