import { defineExtension, type Extension } from "@earendil-works/pi-durable";
import type { CompactReportTask } from "../delivery/compact-report.ts";
import type { DeliverTask } from "../delivery/task.ts";
import type { Logger } from "../runtime/log.ts";
import type { TelegramPort } from "../telegram/port.ts";
import { createSendFileTool } from "../telegram/send-file.ts";

/** The durable part of the channel: its task definitions and the `telegram_send_file` tool. */
export function createTelegramExtension(options: {
	deliver: DeliverTask;
	compactReport: CompactReportTask;
	port: () => TelegramPort;
	log: Logger;
	uploadLimit?: number;
}): Extension {
	const sendFile = createSendFileTool({
		port: options.port,
		log: options.log,
		...(options.uploadLimit === undefined ? {} : { uploadLimit: options.uploadLimit }),
	});
	return defineExtension({
		name: "telegram",
		tasks: [options.deliver, options.compactReport],
		tools: [sendFile],
	});
}
