import { execSync, spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { sandboxEnv } from "../../env.js";
import { deleteProcess, getProcess, setProcess } from "../../infra/services/process-registry.js";
import { loadState, saveState } from "../../infra/services/state-store.js";
import type { ServiceInfo } from "../../types.js";

const LOG_DIR = "/tmp/proliferate/logs";
const USER_CADDY_DIR = "/home/user/.proliferate/caddy";
const USER_CADDY_FILE = `${USER_CADDY_DIR}/user.caddy`;

export function getServices(): ServiceInfo[] {
	const state = loadState();
	for (const [name, info] of Object.entries(state.services)) {
		if (info.status !== "running") continue;
		try {
			process.kill(info.pid, 0);
		} catch {
			state.services[name].status = "stopped";
		}
	}
	saveState(state);
	return Object.values(state.services);
}

export function getExposedPort(): number | null {
	return loadState().exposedPort;
}

export function getLogFilePath(name: string): string | null {
	const service = loadState().services[name];
	return service?.logFile ?? null;
}

export async function startService(input: {
	name: string;
	command: string;
	cwd?: string;
}): Promise<ServiceInfo> {
	const name = input.name;
	const command = input.command;
	const cwd = input.cwd ?? sandboxEnv.workspaceDir;

	mkdirSync(LOG_DIR, { recursive: true });

	const oldState = loadState();
	const existing = oldState.services[name];
	const existingProcess = getProcess(name);
	if (existingProcess) {
		existingProcess.kill("SIGTERM");
		deleteProcess(name);
	} else if (existing?.status === "running") {
		try {
			process.kill(existing.pid, 0);
			try {
				process.kill(-existing.pid, "SIGTERM");
			} catch {
				process.kill(existing.pid, "SIGTERM");
			}
		} catch {
			// Process already exited.
		}
	}

	const logFile = `${LOG_DIR}/${name}.log`;
	const logStream = createWriteStream(logFile, { flags: "a" });
	const timestamp = new Date().toISOString();
	logStream.write(`\n=== Service "${name}" started at ${timestamp} ===\n`);
	logStream.write(`Command: ${command}\n`);
	logStream.write(`Working directory: ${cwd}\n\n`);

	const processHandle = spawn("bash", ["-c", command], {
		cwd,
		// biome-ignore lint/nursery/noProcessEnv: child service needs inherited process env
		env: { ...process.env, FORCE_COLOR: "1" },
		stdio: ["ignore", "pipe", "pipe"],
		detached: true,
	});

	processHandle.stdout?.pipe(logStream);
	processHandle.stderr?.pipe(logStream);
	setProcess(name, processHandle);

	const serviceInfo: ServiceInfo = {
		name,
		command,
		cwd,
		pid: processHandle.pid ?? -1,
		status: "running",
		startedAt: Date.now(),
		logFile,
	};

	const state = loadState();
	state.services[name] = serviceInfo;
	saveState(state);

	processHandle.on("exit", (code) => {
		const latest = loadState();
		if (latest.services[name]) {
			latest.services[name].status = code === 0 ? "stopped" : "error";
			saveState(latest);
		}
		deleteProcess(name);
	});

	return serviceInfo;
}

export async function stopService(input: { name: string }): Promise<void> {
	const name = input.name;
	const processHandle = getProcess(name);
	if (processHandle) {
		processHandle.kill("SIGTERM");
		deleteProcess(name);
	}

	const state = loadState();
	const service = state.services[name];
	if (!service) return;

	if (!processHandle && service.status === "running") {
		try {
			try {
				process.kill(-service.pid, "SIGTERM");
			} catch {
				process.kill(service.pid, "SIGTERM");
			}
		} catch {
			// Already exited.
		}
	}
	service.status = "stopped";
	saveState(state);
}

export async function exposePort(port: number): Promise<void> {
	const state = loadState();
	state.exposedPort = port;
	saveState(state);

	try {
		const current = existsSync(USER_CADDY_FILE) ? readFileSync(USER_CADDY_FILE, "utf-8") : "";
		if (current.includes(`localhost:${port}`)) {
			return;
		}
	} catch {
		// Ignore and rewrite.
	}

	const caddySnippet = `handle {
    reverse_proxy localhost:${port} {
        header_up Host {upstream_hostport}
    }
    header {
        -X-Frame-Options
        -Content-Security-Policy
    }
}`;

	try {
		mkdirSync(USER_CADDY_DIR, { recursive: true });
		writeFileSync(USER_CADDY_FILE, caddySnippet);
		try {
			execSync("pkill -USR1 caddy", { stdio: "pipe" });
		} catch {
			// Caddy may be offline.
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to update user Caddy config: ${message}`);
	}
}
