import { connect } from "node:net";

const SERVICE_ENV_NAMES = [
  "RELEASE_E2E_SERVER_URL",
  "RELEASE_E2E_LOCAL_RUNTIME_URL",
  "RELEASE_E2E_DESKTOP_WEB_URL",
  "RELEASE_E2E_LOCAL_DATABASE_URL",
] as const;

type ServiceEnvName = (typeof SERVICE_ENV_NAMES)[number];

export interface LocalServiceCheck {
  name: ServiceEnvName;
  target: string;
  ready: boolean;
  detail?: string;
}

export interface LocalServicePreflightOptions {
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  tcpProbe?: (host: string, port: number, timeoutMs: number) => Promise<void>;
}

/**
 * Read-only protocol readiness for the selected local services. HTTP services
 * must answer their real health/shell contract; the database currently gets a
 * transport probe after profile metadata has fixed its database identity.
 */
export async function preflightLocalProfileServices(
  requiredNames: readonly string[],
  options: LocalServicePreflightOptions = {},
): Promise<LocalServiceCheck[]> {
  const env = options.env ?? process.env;
  const timeoutMs = options.timeoutMs ?? 750;
  const fetchImpl = options.fetchImpl ?? fetch;
  const tcpProbe = options.tcpProbe ?? probeTcp;
  const required = new Set(requiredNames);
  const checks: LocalServiceCheck[] = [];

  for (const name of SERVICE_ENV_NAMES) {
    if (!required.has(name)) {
      continue;
    }
    const value = env[name]?.trim();
    if (!value) {
      checks.push({ name, target: "unset", ready: false, detail: "environment value is unset" });
      continue;
    }
    let target: { host: string; port: number };
    try {
      target = endpointFor(name, value);
    } catch (error) {
      checks.push({
        name,
        target: "invalid",
        ready: false,
        detail: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    const shownTarget = formatTarget(target.host, target.port);
    try {
      const detail = await probeService(name, value, target, timeoutMs, fetchImpl, tcpProbe);
      checks.push({ name, target: shownTarget, ready: true, detail });
    } catch (error) {
      checks.push({
        name,
        target: shownTarget,
        ready: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return checks;
}

async function probeService(
  name: ServiceEnvName,
  value: string,
  target: { host: string; port: number },
  timeoutMs: number,
  fetchImpl: typeof fetch,
  tcpProbe: (host: string, port: number, timeoutMs: number) => Promise<void>,
): Promise<string> {
  if (name === "RELEASE_E2E_LOCAL_DATABASE_URL") {
    await tcpProbe(target.host, target.port, timeoutMs);
    return "database transport reachable; identity fixed by profile metadata";
  }

  const baseUrl = value.replace(/\/+$/, "");
  const url = name === "RELEASE_E2E_DESKTOP_WEB_URL" ? baseUrl : `${baseUrl}/health`;
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    throw new Error(`${name} protocol probe returned HTTP ${response.status}`);
  }
  if (name === "RELEASE_E2E_DESKTOP_WEB_URL") {
    const body = await response.text();
    if (!body.includes('<div id="root"></div>') || !body.includes("<title>Proliferate</title>")) {
      throw new Error("desktop renderer did not return the Proliferate application shell");
    }
    return "Proliferate application shell served";
  }

  const body = await response.json() as { status?: unknown; version?: unknown };
  if (body.status !== "ok") {
    throw new Error(`${name} health payload status was ${JSON.stringify(body.status)}`);
  }
  const version = typeof body.version === "string" ? body.version.trim() : "";
  if (!version) {
    throw new Error(`${name} health payload omitted version`);
  }
  return `health ok, version ${version}`;
}

function endpointFor(name: ServiceEnvName, value: string): { host: string; port: number } {
  const url = new URL(value);
  const fallbackPort = name === "RELEASE_E2E_LOCAL_DATABASE_URL"
    ? 5432
    : url.protocol === "https:"
      ? 443
      : 80;
  const port = url.port ? Number(url.port) : fallbackPort;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`cannot resolve host/port for ${name}`);
  }
  return { host, port };
}

function formatTarget(host: string, port: number): string {
  return host.includes(":") ? `[${host}]:${port}` : `${host}:${port}`;
}

function probeTcp(host: string, port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish());
    socket.once("timeout", () => finish(new Error(`timed out after ${timeoutMs}ms`)));
    socket.once("error", (error) => finish(error));
  });
}
