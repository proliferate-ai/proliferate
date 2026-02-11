import { type ChildProcess, spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { ServiceInfo, State } from "./types.js";

// Use /tmp for state/logs (user-writable, doesn't require root)
const STATE_FILE = "/tmp/proliferate/state.json";
const LOG_DIR = "/tmp/proliferate/logs";
const USER_CADDY_DIR = "/home/user/.proliferate/caddy";
const USER_CADDY_FILE = `${USER_CADDY_DIR}/user.caddy`;
const DEFAULT_WORKSPACE_DIR = process.env.WORKSPACE_DIR ?? process.cwd();

const processes: Map<string, ChildProcess> = new Map();

function loadState(): State {
	try {
		if (existsSync(STATE_FILE)) {
			return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
		}
	} catch {
		// Ignore errors
	}
	return { services: {}, exposedPort: null };
}

function saveState(state: State): void {
	mkdirSync("/tmp/proliferate", { recursive: true });
	writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function getServices(): ServiceInfo[] {
	const state = loadState();
	// Check if processes are still alive
	for (const [name, info] of Object.entries(state.services)) {
		if (info.status === "running") {
			try {
				process.kill(info.pid, 0); // Check if process exists
			} catch {
				state.services[name].status = "stopped";
			}
		}
	}
	saveState(state);
	return Object.values(state.services);
}

export function getExposedPort(): number | null {
	return loadState().exposedPort;
}

export function getLogFilePath(name: string): string | null {
	const state = loadState();
	const service = state.services[name];
	return service?.logFile ?? null;
}

export async function startService(opts: {
	name: string;
	command: string;
	cwd?: string;
}): Promise<ServiceInfo> {
	const { name, command, cwd = DEFAULT_WORKSPACE_DIR } = opts;

	// Ensure log directory exists
	mkdirSync(LOG_DIR, { recursive: true });

	// Stop existing service with same name (handles both in-memory and orphaned PIDs)
	const oldState = loadState();
	const existing = oldState.services[name];
	if (processes.has(name)) {
		processes.get(name)?.kill("SIGTERM");
		processes.delete(name);
	} else if (existing?.status === "running") {
		try {
			process.kill(existing.pid, 0);
			// Kill process group (negative PID) to catch detached children
			try {
				process.kill(-existing.pid, "SIGTERM");
			} catch {
				process.kill(existing.pid, "SIGTERM");
			}
		} catch {
			// Already dead
		}
	}

	const logFile = `${LOG_DIR}/${name}.log`;
	const logStream = createWriteStream(logFile, { flags: "a" });

	// Write start marker
	const timestamp = new Date().toISOString();
	logStream.write(`\n=== Service "${name}" started at ${timestamp} ===\n`);
	logStream.write(`Command: ${command}\n`);
	logStream.write(`Working directory: ${cwd}\n\n`);

	// Spawn process
	const proc = spawn("bash", ["-c", command], {
		cwd,
		env: { ...process.env, FORCE_COLOR: "1" },
		stdio: ["ignore", "pipe", "pipe"],
		detached: true,
	});

	proc.stdout?.pipe(logStream);
	proc.stderr?.pipe(logStream);

	processes.set(name, proc);

	const serviceInfo: ServiceInfo = {
		name,
		command,
		cwd,
		pid: proc.pid!,
		status: "running",
		startedAt: Date.now(),
		logFile,
	};

	// Update state
	const state = loadState();
	state.services[name] = serviceInfo;
	saveState(state);

	// Handle exit
	proc.on("exit", (code) => {
		const s = loadState();
		if (s.services[name]) {
			s.services[name].status = code === 0 ? "stopped" : "error";
			saveState(s);
		}
		processes.delete(name);
	});

	return serviceInfo;
}

export async function stopService(opts: { name: string }): Promise<void> {
	const { name } = opts;

	const proc = processes.get(name);
	if (proc) {
		proc.kill("SIGTERM");
		processes.delete(name);
	}

	const state = loadState();
	const service = state.services[name];
	if (service) {
		// Kill by PID if we don't have the ChildProcess reference (e.g. after restart)
		if (!proc && service.status === "running") {
			try {
				// Kill process group (negative PID) to catch detached children
				try {
					process.kill(-service.pid, "SIGTERM");
				} catch {
					process.kill(service.pid, "SIGTERM");
				}
			} catch {
				// Already dead
			}
		}
		service.status = "stopped";
		saveState(state);
	}
}

export async function exposePort(port: number): Promise<void> {
	const { execSync } = await import("node:child_process");

	// Update state
	const state = loadState();
	state.exposedPort = port;
	saveState(state);

	// Check if already exposed to this port
	try {
		const currentConfig = existsSync(USER_CADDY_FILE) ? readFileSync(USER_CADDY_FILE, "utf-8") : "";
		if (currentConfig.includes(`localhost:${port}`)) {
			return; // Already configured
		}
	} catch {
		// Ignore read errors, proceed to write
	}

	// Write user Caddy snippet (imported by main Caddyfile via `import` directive).
	// This bare "handle" block intentionally takes priority over the default
	// multi-port fallback, routing all non-devtools traffic to the user's chosen port.
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

		// Reload Caddy using SIGUSR1 (no sudo required)
		try {
			execSync("pkill -USR1 caddy", { stdio: "pipe" });
		} catch {
			// Caddy not running — it will pick up the import on next start
		}
	} catch (error: any) {
		throw new Error(`Failed to update user Caddy config: ${error.message}`);
	}
}
