import { type ChildProcess, spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { runtimeEnv } from "@proliferate/environment/runtime";
import { env } from "@proliferate/environment/server";
import type { ServiceInfo, State } from "./types.js";

// Use /tmp for state/logs (user-writable, doesn't require root)
const STATE_FILE = "/tmp/proliferate/state.json";
const LOG_DIR = "/tmp/proliferate/logs";
const CADDYFILE = "/home/user/Caddyfile"; // Match sandbox provider setup (avoid /tmp - Docker can restrict it)
const DEFAULT_WORKSPACE_DIR = env.WORKSPACE_DIR ?? process.cwd();

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

	// Stop existing service with same name
	if (processes.has(name)) {
		const oldProc = processes.get(name);
		oldProc?.kill("SIGTERM");
		processes.delete(name);
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
		env: { ...runtimeEnv, FORCE_COLOR: "1" },
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
	if (state.services[name]) {
		state.services[name].status = "stopped";
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
		const currentConfig = existsSync(CADDYFILE) ? readFileSync(CADDYFILE, "utf-8") : "";
		if (currentConfig.includes(`localhost:${port}`)) {
			return; // Already configured
		}
	} catch {
		// Ignore read errors, proceed to write
	}

	// Update Caddyfile to proxy to this port
	// CRITICAL: Preserve the /api/* handler for internal sandbox-mcp API
	const caddyfile = `:20000 {
    # Keep the internal API accessible
    handle /api/* {
        reverse_proxy localhost:4000
    }

    # Route all other traffic to the user's exposed port
    handle {
        reverse_proxy localhost:${port} {
            header_up Host {upstream_hostport}
        }
        header {
            -X-Frame-Options
            -Content-Security-Policy
        }
    }
}`;

	// Write directly to Caddyfile (it's world-writable in Modal sandbox)
	// Modal has "no new privileges" flag which blocks sudo entirely
	try {
		// Write directly to Caddyfile
		writeFileSync(CADDYFILE, caddyfile);

		// Reload Caddy using SIGUSR1 (no sudo required)
		// This tells Caddy to gracefully reload its configuration
		try {
			execSync("pkill -USR1 caddy", { stdio: "pipe" });
		} catch {
			// If pkill fails (caddy not running), start it
			execSync(`caddy start --config ${CADDYFILE}`, { stdio: "pipe" });
		}
	} catch (error: any) {
		throw new Error(`Failed to update Caddyfile: ${error.message}`);
	}
}
