import type { Logger } from "@proliferate/logger";
import type { DaemonStreamEnvelope } from "@proliferate/shared/contracts/harness";
import type { CodingHarnessAdapter } from "../../../harness/contracts/coding";
import type { RuntimeDaemonEvent } from "../../../harness/contracts/coding";
import type { GatewayEnv } from "../../../lib/env";

export async function connectCodingEventStream(input: {
	codingHarness: CodingHarnessAdapter;
	runtimeBaseUrl: string;
	authToken: string;
	afterSeq?: number;
	bindingId: string;
	env: GatewayEnv;
	logger: Logger;
	onDisconnect: (reason: string) => void;
	onEvent: (event: RuntimeDaemonEvent) => void;
	onDaemonEnvelope?: (event: DaemonStreamEnvelope) => void;
	onLog: (message: string, data?: Record<string, unknown>) => void;
}): Promise<import("../../../harness/contracts/coding").CodingHarnessEventStreamHandle> {
	input.onLog("Connecting to coding harness event stream...", { url: input.runtimeBaseUrl });
	const handle = await input.codingHarness.streamEvents({
		baseUrl: input.runtimeBaseUrl,
		authToken: input.authToken,
		afterSeq: input.afterSeq,
		bindingId: input.bindingId,
		env: input.env,
		logger: input.logger,
		onDisconnect: (reason) => input.onDisconnect(reason),
		onEvent: (event) => {
			input.logger.debug(
				{ channel: event.channel, type: event.type },
				"runtime.daemon_event.normalized",
			);
			input.onEvent(event);
		},
		onDaemonEnvelope: input.onDaemonEnvelope,
	});
	input.onLog("Harness event stream connected");
	return handle;
}
