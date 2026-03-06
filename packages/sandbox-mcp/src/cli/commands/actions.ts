import { GatewayActionsClient } from "../../infra/http/gateway-actions-client.js";
import { CliError } from "../errors.js";
import type { CliFlags } from "../flags.js";
import { requireFlag } from "../flags.js";
import { writeJson, writeStderr } from "../output.js";

const POLL_INTERVAL_MS = 2_000;

const gateway = new GatewayActionsClient();

export async function actionsList(): Promise<void> {
	const { data } = await gateway.request("GET", "/available");
	writeJson(data);
}

export async function actionsGuide(flags: CliFlags): Promise<void> {
	const integration = requireFlag(flags, "integration");
	const { status, data } = await gateway.request(
		"GET",
		`/guide/${encodeURIComponent(integration)}`,
	);
	if (status >= 400) {
		const body = data as { error?: string; message?: string };
		throw new CliError(body.error || body.message || `Failed to fetch guide (HTTP ${status})`, 1);
	}
	const body = data as { guide?: string };
	if (body.guide) {
		process.stdout.write(body.guide);
		return;
	}
	writeJson(data);
}

export async function actionsRun(flags: CliFlags): Promise<void> {
	const integration = requireFlag(flags, "integration");
	const action = requireFlag(flags, "action");
	let params: Record<string, unknown> = {};
	if (typeof flags.params === "string") {
		try {
			params = JSON.parse(flags.params) as Record<string, unknown>;
		} catch {
			throw new CliError("Invalid JSON in --params", 1);
		}
	}

	const { status, data } = await gateway.request("POST", "/invoke", {
		integration,
		action,
		params,
	});
	const body = data as {
		invocation?: { id: string; status: string };
		result?: unknown;
		error?: string;
		message?: string;
	};

	if (status === 200 && body.result !== undefined) {
		writeJson(body.result);
		return;
	}
	if (status === 403) {
		throw new CliError(body.error || "Action denied", 1);
	}
	if (status >= 400) {
		throw new CliError(body.error || body.message || `HTTP ${status}`, 1);
	}

	if (status === 202 && body.invocation?.id) {
		const invocationId = body.invocation.id;
		writeStderr("Waiting for approval...");
		while (true) {
			await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
			const poll = await gateway.request("GET", `/invocations/${invocationId}`);
			const invocation = (
				poll.data as { invocation?: { status: string; result?: unknown; error?: string } }
			).invocation;
			if (!invocation) continue;
			if (invocation.status === "completed") {
				writeJson(invocation.result);
				return;
			}
			if (
				invocation.status === "denied" ||
				invocation.status === "failed" ||
				invocation.status === "expired"
			) {
				throw new CliError(`Action ${invocation.status}: ${invocation.error || ""}`, 1);
			}
		}
	}

	writeJson(body);
}
