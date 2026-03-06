import { SandboxApiClient } from "../../infra/http/sandbox-api-client.js";
import { CliError } from "../errors.js";
import type { CliFlags } from "../flags.js";
import { requireFlag } from "../flags.js";
import { writeJson } from "../output.js";

const apiClient = new SandboxApiClient();

export async function servicesList(): Promise<void> {
	const data = await apiClient.request("GET", "/api/services");
	writeJson(data);
}

export async function servicesStart(flags: CliFlags): Promise<void> {
	const name = requireFlag(flags, "name");
	const command = requireFlag(flags, "command");
	const cwd = typeof flags.cwd === "string" ? flags.cwd : undefined;
	const body: Record<string, unknown> = { name, command };
	if (cwd) body.cwd = cwd;
	const data = await apiClient.request("POST", "/api/services", body);
	writeJson(data);
}

export async function servicesStop(flags: CliFlags): Promise<void> {
	const name = requireFlag(flags, "name");
	const data = await apiClient.request("DELETE", `/api/services/${encodeURIComponent(name)}`);
	writeJson(data);
}

export async function servicesRestart(flags: CliFlags): Promise<void> {
	const name = requireFlag(flags, "name");
	const list = (await apiClient.request("GET", "/api/services")) as {
		services: Array<{ name: string; command: string; cwd: string }>;
	};
	const service = list.services.find((entry) => entry.name === name);
	if (!service) {
		throw new CliError(`Service "${name}" not found`, 1);
	}
	await apiClient.request("DELETE", `/api/services/${encodeURIComponent(name)}`);
	const data = await apiClient.request("POST", "/api/services", {
		name: service.name,
		command: service.command,
		cwd: service.cwd,
	});
	writeJson(data);
}

export async function servicesExpose(flags: CliFlags): Promise<void> {
	const portString = requireFlag(flags, "port");
	const port = Number(portString);
	if (!Number.isFinite(port) || port <= 0) {
		throw new CliError("--port must be a positive number", 2);
	}
	const data = await apiClient.request("POST", "/api/expose", { port });
	writeJson(data);
}

export async function servicesLogs(flags: CliFlags): Promise<void> {
	const name = requireFlag(flags, "name");
	const follow = flags.follow === true;
	await apiClient.streamLogs(`/api/logs/${encodeURIComponent(name)}`, follow);
}
