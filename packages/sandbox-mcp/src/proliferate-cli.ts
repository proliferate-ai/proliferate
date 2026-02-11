import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

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

  env apply --spec <json>                          Generate env files from spec
  env scrub --spec <json>                          Delete secret env files

  actions list                                     List available integrations and actions
  actions run --integration <i> --action <a> [--params <json>]  Run an action
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

// ── Env commands ──

const WORKSPACE_DIR = process.env.WORKSPACE_DIR || "/home/user/workspace";
const PROLIFERATE_ENV_FILE = "/tmp/.proliferate_env.json";

interface EnvFileSpec {
	workspacePath: string;
	path: string;
	format: string;
	mode: string;
	keys: Array<{ key: string; required: boolean }>;
}

function parseSpec(flags: Record<string, string | boolean>): EnvFileSpec[] {
	const raw = requireFlag(flags, "spec");
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) fatal("--spec must be a JSON array", 2);
		return parsed as EnvFileSpec[];
	} catch (err) {
		if (err instanceof SyntaxError) fatal(`Invalid JSON in --spec: ${err.message}`, 2);
		throw err;
	}
}

function safePath(base: string, untrusted: string): string {
	if (isAbsolute(untrusted)) fatal(`Path must be relative: ${untrusted}`, 2);
	if (untrusted.split("/").includes("..")) fatal(`Path must not contain '..': ${untrusted}`, 2);
	const resolved = resolve(base, untrusted);
	const rel = relative(base, resolved);
	if (rel.startsWith("..") || isAbsolute(rel)) {
		fatal(`Path escapes workspace: ${untrusted}`, 2);
	}
	return resolved;
}

function resolveWorkspacePath(workspacePath: string): string {
	if (workspacePath === "." || workspacePath === "") return WORKSPACE_DIR;
	return safePath(WORKSPACE_DIR, workspacePath);
}

function addToGitExclude(repoDir: string, filePath: string): void {
	const excludeFile = join(repoDir, ".git", "info", "exclude");
	const excludeDir = dirname(excludeFile);
	if (!existsSync(join(repoDir, ".git"))) return;
	mkdirSync(excludeDir, { recursive: true });
	const existing = existsSync(excludeFile) ? readFileSync(excludeFile, "utf-8") : "";
	if (!existing.split("\n").includes(filePath)) {
		appendFileSync(
			excludeFile,
			`${existing.endsWith("\n") || existing === "" ? "" : "\n"}${filePath}\n`,
		);
	}
}

function loadEnvOverrides(): Record<string, string> {
	try {
		if (existsSync(PROLIFERATE_ENV_FILE)) {
			const data = JSON.parse(readFileSync(PROLIFERATE_ENV_FILE, "utf-8"));
			if (typeof data === "object" && data !== null) {
				const overrides: Record<string, string> = {};
				for (const [k, v] of Object.entries(data)) {
					if (typeof v === "string") overrides[k] = v;
				}
				return overrides;
			}
		}
	} catch {
		// Ignore parse/read errors — fall back to process.env only
	}
	return {};
}

async function envApply(flags: Record<string, string | boolean>): Promise<void> {
	const spec = parseSpec(flags);
	const envOverrides = loadEnvOverrides();
	const missing: string[] = [];

	// First pass: validate all entries and collect missing keys before writing anything
	const prepared: Array<{
		repoDir: string;
		filePath: string;
		entryPath: string;
		lines: string[];
	}> = [];

	for (const entry of spec) {
		const repoDir = resolveWorkspacePath(entry.workspacePath);
		const filePath = safePath(repoDir, entry.path);
		const lines: string[] = [];

		for (const { key, required } of entry.keys) {
			const val = envOverrides[key] ?? process.env[key];
			if (val === undefined) {
				if (required) missing.push(key);
				continue;
			}
			lines.push(`${key}=${val}`);
		}

		prepared.push({ repoDir, filePath, entryPath: entry.path, lines });
	}

	if (missing.length > 0) {
		fatal(`Missing required environment variables: ${missing.join(", ")}`, 1);
	}

	// Second pass: write files (only reached if no required keys are missing)
	const applied: Array<{ path: string; keyCount: number }> = [];
	for (const { repoDir, filePath, entryPath, lines } of prepared) {
		mkdirSync(dirname(filePath), { recursive: true });
		writeFileSync(filePath, `${lines.join("\n")}\n`);
		addToGitExclude(repoDir, entryPath);
		applied.push({ path: entryPath, keyCount: lines.length });
	}

	writeJson({ applied });
}

async function envScrub(flags: Record<string, string | boolean>): Promise<void> {
	const spec = parseSpec(flags);
	const scrubbed: string[] = [];

	for (const entry of spec) {
		if (entry.mode !== "secret") continue;
		const repoDir = resolveWorkspacePath(entry.workspacePath);
		const filePath = safePath(repoDir, entry.path);
		if (existsSync(filePath)) {
			unlinkSync(filePath);
			scrubbed.push(entry.path);
		}
	}

	if (existsSync(PROLIFERATE_ENV_FILE)) {
		unlinkSync(PROLIFERATE_ENV_FILE);
		scrubbed.push(PROLIFERATE_ENV_FILE);
	}

	writeJson({ scrubbed });
}

// ── Actions commands (calls Gateway, not sandbox-mcp) ──

const GATEWAY_URL = process.env.PROLIFERATE_GATEWAY_URL;
const SESSION_ID = process.env.PROLIFERATE_SESSION_ID;

const ACTIONS_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 2_000;

async function gatewayRequest(
	method: string,
	path: string,
	body?: Record<string, unknown>,
): Promise<{ status: number; data: unknown }> {
	if (!GATEWAY_URL || !SESSION_ID) {
		fatal("Actions require PROLIFERATE_GATEWAY_URL and PROLIFERATE_SESSION_ID", 1);
	}
	if (!AUTH_TOKEN) {
		fatal("Auth token not set. Set SANDBOX_MCP_AUTH_TOKEN.", 2);
	}

	const url = `${GATEWAY_URL}/proliferate/${SESSION_ID}/actions${path}`;
	const res = await fetch(url, {
		method,
		headers: {
			Authorization: `Bearer ${AUTH_TOKEN}`,
			"Content-Type": "application/json",
		},
		body: body ? JSON.stringify(body) : undefined,
		signal: AbortSignal.timeout(ACTIONS_TIMEOUT_MS),
	});

	const data = await res.json();
	return { status: res.status, data };
}

async function actionsList(): Promise<void> {
	const { data } = await gatewayRequest("GET", "/available");
	writeJson(data);
}

async function actionsRun(flags: Record<string, string | boolean>): Promise<void> {
	const integration = requireFlag(flags, "integration");
	const action = requireFlag(flags, "action");
	let params: Record<string, unknown> = {};
	if (typeof flags.params === "string") {
		try {
			params = JSON.parse(flags.params) as Record<string, unknown>;
		} catch {
			fatal("Invalid JSON in --params", 1);
		}
	}

	const { status, data } = await gatewayRequest("POST", "/invoke", {
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

	// Immediate result (auto-approved reads)
	if (status === 200 && body.result !== undefined) {
		writeJson(body.result);
		return;
	}

	// Denied
	if (status === 403) {
		fatal(body.error || "Action denied", 1);
	}

	// Error
	if (status >= 400) {
		fatal(body.error || body.message || `HTTP ${status}`, 1);
	}

	// Pending approval (202) — poll until resolved
	if (status === 202 && body.invocation?.id) {
		const invocationId = body.invocation.id;
		process.stderr.write("Waiting for approval...\n");

		while (true) {
			await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
			const poll = await gatewayRequest("GET", `/invocations/${invocationId}`);
			const inv = (
				poll.data as { invocation?: { status: string; result?: unknown; error?: string } }
			).invocation;
			if (!inv) continue;

			if (inv.status === "completed") {
				writeJson(inv.result);
				return;
			}
			if (inv.status === "denied" || inv.status === "failed" || inv.status === "expired") {
				fatal(`Action ${inv.status}: ${inv.error || ""}`, 1);
			}
			// Still pending — keep polling
		}
	}

	// Fallback
	writeJson(body);
}

// ── Main dispatch ──

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	if (args.length === 0) usage();

	const group = args[0];
	const action = args[1];
	const flags = parseFlags(args.slice(2));

	if (group === "services") {
		if (!AUTH_TOKEN) {
			fatal("Auth token not set. Set SANDBOX_MCP_AUTH_TOKEN or SERVICE_TO_SERVICE_AUTH_TOKEN.", 2);
		}
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
	} else if (group === "env") {
		switch (action) {
			case "apply":
				await envApply(flags);
				break;
			case "scrub":
				await envScrub(flags);
				break;
			default:
				usage();
		}
	} else if (group === "actions") {
		switch (action) {
			case "list":
				await actionsList();
				break;
			case "run":
				await actionsRun(flags);
				break;
			default:
				usage();
		}
	} else {
		usage();
	}
}

main().catch((err: Error) => {
	process.stderr.write(`Error: ${err.message}\n`);
	process.exit(1);
});
