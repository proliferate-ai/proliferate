import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

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

function resolveWorkspacePath(workspacePath: string): string {
	if (workspacePath === "." || workspacePath === "") return WORKSPACE_DIR;
	return join(WORKSPACE_DIR, workspacePath);
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

async function envApply(flags: Record<string, string | boolean>): Promise<void> {
	const spec = parseSpec(flags);
	const missing: string[] = [];
	const applied: Array<{ path: string; keyCount: number }> = [];

	for (const entry of spec) {
		const repoDir = resolveWorkspacePath(entry.workspacePath);
		const filePath = resolve(repoDir, entry.path);
		const lines: string[] = [];

		for (const { key, required } of entry.keys) {
			const val = process.env[key];
			if (val === undefined) {
				if (required) missing.push(key);
				continue;
			}
			lines.push(`${key}=${val}`);
		}

		if (missing.length > 0) continue;

		mkdirSync(dirname(filePath), { recursive: true });
		writeFileSync(filePath, `${lines.join("\n")}\n`);
		addToGitExclude(repoDir, entry.path);
		applied.push({ path: entry.path, keyCount: lines.length });
	}

	if (missing.length > 0) {
		fatal(`Missing required environment variables: ${missing.join(", ")}`, 1);
	}
	writeJson({ applied });
}

async function envScrub(flags: Record<string, string | boolean>): Promise<void> {
	const spec = parseSpec(flags);
	const scrubbed: string[] = [];

	for (const entry of spec) {
		if (entry.mode !== "secret") continue;
		const repoDir = resolveWorkspacePath(entry.workspacePath);
		const filePath = resolve(repoDir, entry.path);
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
	} else {
		usage();
	}
}

main().catch((err: Error) => {
	process.stderr.write(`Error: ${err.message}\n`);
	process.exit(1);
});
