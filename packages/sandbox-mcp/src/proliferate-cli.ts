const BASE_URL = process.env.PROLIFERATE_SANDBOX_MCP_URL || "http://127.0.0.1:4000";

const AUTH_TOKEN = process.env.SANDBOX_MCP_AUTH_TOKEN || process.env.SERVICE_TO_SERVICE_AUTH_TOKEN;

function fatal(message: string, exitCode: number): never {
	process.stderr.write(`Error: ${message}\n`);
	process.exit(exitCode);
}

function usage(): never {
	process.stderr.write(`Usage: proliferate <command>

Commands:
  services list                                    List all services
  services start --name <n> --command <cmd> [--cwd <dir>]  Start a service
  services stop --name <n>                         Stop a service
  services restart --name <n>                      Restart a service
  services expose --port <port>                    Expose a port for preview
  services logs --name <n> [--follow]              View service logs
`);
	process.exit(2);
}

function parseFlags(args: string[]): Record<string, string | boolean> {
	const flags: Record<string, string | boolean> = {};
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--follow") {
			flags.follow = true;
		} else if (arg.startsWith("--") && i + 1 < args.length && !args[i + 1].startsWith("--")) {
			flags[arg.slice(2)] = args[i + 1];
			i++;
		}
	}
	return flags;
}

function requireFlag(flags: Record<string, string | boolean>, key: string): string {
	const val = flags[key];
	if (typeof val !== "string" || val.length === 0) {
		fatal(`Missing required flag: --${key}`, 2);
	}
	return val;
}

const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 30_000;

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
		} catch (err: unknown) {
			const isConnError =
				err instanceof TypeError &&
				(err.message.includes("ECONNREFUSED") || err.message.includes("fetch failed"));
			if (isConnError && attempt < MAX_RETRIES) {
				await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
				continue;
			}
			throw err;
		}
	}
}

async function request(
	method: string,
	path: string,
	body?: Record<string, unknown>,
): Promise<unknown> {
	const res = await fetchWithRetry(`${BASE_URL}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${AUTH_TOKEN}`,
			"Content-Type": "application/json",
		},
		body: body ? JSON.stringify(body) : undefined,
	});
	const json = await res.json();
	if (!res.ok) {
		const msg =
			typeof json === "object" && json !== null && "error" in json
				? (json as { error: string }).error
				: `HTTP ${res.status}`;
		fatal(msg, 1);
	}
	return json;
}

async function streamSSE(path: string, follow: boolean): Promise<void> {
	const res = await fetchWithRetry(`${BASE_URL}${path}`, {
		headers: {
			Authorization: `Bearer ${AUTH_TOKEN}`,
			Accept: "text/event-stream",
		},
	});
	if (!res.ok) {
		let msg = `HTTP ${res.status}`;
		try {
			const json = (await res.json()) as { error?: string };
			if (json.error) msg = json.error;
		} catch {
			// Ignore JSON parse errors; use the HTTP status message
		}
		fatal(msg, 1);
	}
	const reader = res.body?.getReader();
	if (!reader) fatal("No response body", 1);

	const decoder = new TextDecoder();
	let buffer = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });

		// Process complete SSE frames (separated by double newline)
		let idx = buffer.indexOf("\n\n");
		while (idx !== -1) {
			const frame = buffer.slice(0, idx);
			buffer = buffer.slice(idx + 2);

			for (const line of frame.split("\n")) {
				if (line.startsWith("data: ")) {
					const payload = line.slice(6);
					process.stdout.write(`${payload}\n`);

					if (!follow) {
						reader.cancel();
						return;
					}
				}
			}

			idx = buffer.indexOf("\n\n");
		}
	}
}

function writeJson(data: unknown): void {
	process.stdout.write(`${JSON.stringify(data)}\n`);
}

async function servicesList(): Promise<void> {
	const data = await request("GET", "/api/services");
	writeJson(data);
}

async function servicesStart(flags: Record<string, string | boolean>): Promise<void> {
	const name = requireFlag(flags, "name");
	const command = requireFlag(flags, "command");
	const cwd = typeof flags.cwd === "string" ? flags.cwd : undefined;
	const body: Record<string, unknown> = { name, command };
	if (cwd) body.cwd = cwd;
	const data = await request("POST", "/api/services", body);
	writeJson(data);
}

async function servicesStop(flags: Record<string, string | boolean>): Promise<void> {
	const name = requireFlag(flags, "name");
	const data = await request("DELETE", `/api/services/${encodeURIComponent(name)}`);
	writeJson(data);
}

async function servicesRestart(flags: Record<string, string | boolean>): Promise<void> {
	const name = requireFlag(flags, "name");

	// Fetch current service info to get command/cwd
	const list = (await request("GET", "/api/services")) as {
		services: Array<{ name: string; command: string; cwd: string }>;
	};
	const svc = list.services.find((s) => s.name === name);
	if (!svc) fatal(`Service "${name}" not found`, 1);

	// Stop then start
	await request("DELETE", `/api/services/${encodeURIComponent(name)}`);
	const data = await request("POST", "/api/services", {
		name: svc.name,
		command: svc.command,
		cwd: svc.cwd,
	});
	writeJson(data);
}

async function servicesExpose(flags: Record<string, string | boolean>): Promise<void> {
	const portStr = requireFlag(flags, "port");
	const port = Number(portStr);
	if (!Number.isFinite(port) || port <= 0) {
		fatal("--port must be a positive number", 2);
	}
	const data = await request("POST", "/api/expose", { port });
	writeJson(data);
}

async function servicesLogs(flags: Record<string, string | boolean>): Promise<void> {
	const name = requireFlag(flags, "name");
	const follow = flags.follow === true;
	await streamSSE(`/api/logs/${encodeURIComponent(name)}`, follow);
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	if (args.length === 0) usage();

	const group = args[0];
	const action = args[1];
	if (group !== "services") usage();

	if (!AUTH_TOKEN) {
		fatal("Auth token not set. Set SANDBOX_MCP_AUTH_TOKEN or SERVICE_TO_SERVICE_AUTH_TOKEN.", 2);
	}

	const flags = parseFlags(args.slice(2));

	switch (action) {
		case "list":
			await servicesList();
			break;
		case "start":
			await servicesStart(flags);
			break;
		case "stop":
			await servicesStop(flags);
			break;
		case "restart":
			await servicesRestart(flags);
			break;
		case "expose":
			await servicesExpose(flags);
			break;
		case "logs":
			await servicesLogs(flags);
			break;
		default:
			usage();
	}
}

main().catch((err: Error) => {
	process.stderr.write(`Error: ${err.message}\n`);
	process.exit(1);
});
