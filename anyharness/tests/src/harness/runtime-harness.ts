import { spawn, type ChildProcessWithoutNullStreams, execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

import { AnyHarnessClient, reduceEvents, streamSession, type SessionEventEnvelope, type TranscriptState } from "@anyharness/sdk";

import { createTestWorkspace, type TestWorkspace } from "../fixtures/test-workspace.js";
import { ensureLocalAgentLaunchers } from "./local-agent-launchers.js";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const ANYHARNESS_BINARY = join(REPO_ROOT, "target", "debug", "anyharness");

export interface PromptResult {
  events: SessionEventEnvelope[];
  transcript: TranscriptState;
}

export interface PromptCollectionOptions {
  timeoutMs?: number;
  stopWhen?: (envelope: SessionEventEnvelope, events: SessionEventEnvelope[]) => boolean;
}

export interface RuntimeHarness {
  readonly baseUrl: string;
  readonly authToken?: string;
  readonly client: AnyHarnessClient;
  createTestWorkspace(name?: string): Promise<TestWorkspace>;
  close(): Promise<void>;
  promptAndCollect(
    sessionId: string,
    text: string,
    options?: PromptCollectionOptions,
  ): Promise<PromptResult>;
  promptAndCollectUntil(
    sessionId: string,
    text: string,
    options: PromptCollectionOptions,
  ): Promise<PromptResult>;
}

export interface CreateRuntimeHarnessOptions {
  requireAgents?: boolean;
  agentSource?: "managed" | "override";
  installAgents?: readonly string[];
}

export async function createRuntimeHarness(
  options: CreateRuntimeHarnessOptions = {},
): Promise<RuntimeHarness> {
  const requireAgents = options.requireAgents ?? true;
  const agentSource = resolveAgentSource(options.agentSource);
  const installAgents = options.installAgents ?? [];
  const baseUrl = process.env.ANYHARNESS_TEST_BASE_URL?.trim();
  if (baseUrl) {
    const authToken = process.env.ANYHARNESS_TEST_AUTH_TOKEN?.trim() || undefined;
    const sourceWorkspacePath = process.env.ANYHARNESS_TEST_WORKSPACE_PATH?.trim();
    const pathAccess = process.env.ANYHARNESS_TEST_PATH_ACCESS?.trim() === "remote" ? "remote" : "local";
    const client = new AnyHarnessClient({ baseUrl, authToken });
    return {
      baseUrl,
      authToken,
      client,
      createTestWorkspace: async (name = "external-runtime") => {
        if (pathAccess === "local") {
          return createTestWorkspace(name);
        }
        if (!sourceWorkspacePath) {
          throw new Error(
            "ANYHARNESS_TEST_WORKSPACE_PATH is required when using a remote external runtime harness",
          );
        }
        return createRemoteWorkspaceFixture(client, sourceWorkspacePath, name);
      },
      close: async () => {},
      promptAndCollect: (sessionId, text, options) =>
        collectPrompt(baseUrl, authToken, sessionId, text, options),
      promptAndCollectUntil: (sessionId, text, options) =>
        collectPrompt(baseUrl, authToken, sessionId, text, options),
    };
  }

  execFileSync("cargo", ["build", "--bin", "anyharness"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: process.env,
  });

  const runtimeHome = await mkdtemp(join(tmpdir(), "anyharness-runtime-"));
  const authToken = randomUUID();
  const port = await getFreePort();
  const baseLocalUrl = `http://127.0.0.1:${port}`;
  const launchEnv =
    requireAgents && agentSource === "override" ? ensureLocalAgentLaunchers() : {};
  if (requireAgents && agentSource === "managed" && installAgents.length > 0) {
    execFileSync(
      ANYHARNESS_BINARY,
      [
        "install-agents",
        "--runtime-home",
        runtimeHome,
        ...installAgents.flatMap((kind) => ["--agent", kind]),
      ],
      {
        cwd: REPO_ROOT,
        stdio: "inherit",
        env: process.env,
      },
    );
  }
  const child = spawn(
    ANYHARNESS_BINARY,
    [
      "serve",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--runtime-home",
      runtimeHome,
      "--require-bearer-auth",
    ],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        ...launchEnv,
        ANYHARNESS_BEARER_TOKEN: authToken,
      },
      stdio: "pipe",
    },
  );

  const stderr: string[] = [];
  child.stderr.on("data", (chunk) => {
    stderr.push(chunk.toString());
  });

  await waitForHealth(baseLocalUrl, authToken, child, stderr);

  return {
    baseUrl: baseLocalUrl,
    authToken,
    client: new AnyHarnessClient({ baseUrl: baseLocalUrl, authToken }),
    createTestWorkspace: (name = "local-runtime") => createTestWorkspace(name),
    close: async () => {
      child.kill("SIGTERM");
      await onceClosed(child);
      await removeRuntimeHome(runtimeHome);
    },
    promptAndCollect: (sessionId, text, options) =>
      collectPrompt(baseLocalUrl, authToken, sessionId, text, options),
    promptAndCollectUntil: (sessionId, text, options) =>
      collectPrompt(baseLocalUrl, authToken, sessionId, text, options),
  };
}

async function createRemoteWorkspaceFixture(
  client: AnyHarnessClient,
  sourceWorkspacePath: string,
  name: string,
): Promise<TestWorkspace> {
  const sourceWorkspace = await client.workspaces.resolveFromPath(sourceWorkspacePath);
  const sourceWorkspaceId = sourceWorkspace.workspace.id;
  const fixturePath = buildRemoteFixturePath(sourceWorkspacePath, name);

  await runRemotePython(
    client,
    sourceWorkspaceId,
    sourceWorkspacePath,
    fixturePath,
    [
      "import pathlib, shutil, subprocess, sys",
      "src = pathlib.Path(sys.argv[1])",
      "dst = pathlib.Path(sys.argv[2])",
      "dst.parent.mkdir(parents=True, exist_ok=True)",
      "shutil.rmtree(dst, ignore_errors=True)",
      "head = subprocess.check_output(['git', '-C', str(src), 'rev-parse', 'HEAD'], text=True).strip()",
      "subprocess.check_call(['git', 'clone', str(src), str(dst)])",
      "subprocess.check_call(['git', '-C', str(dst), 'checkout', head])",
      "subprocess.check_call(['git', '-C', str(dst), 'config', 'user.name', 'Proliferate Cloud Test'])",
      "subprocess.check_call(['git', '-C', str(dst), 'config', 'user.email', 'user@e2b.local'])",
    ].join("; "),
  );

  return {
    path: fixturePath,
    pathAccess: "remote",
    cleanup: async () => {
      await runRemotePython(
        client,
        sourceWorkspaceId,
        sourceWorkspacePath,
        fixturePath,
        [
          "import pathlib, shutil, sys",
          "dst = pathlib.Path(sys.argv[2])",
          "shutil.rmtree(dst, ignore_errors=True)",
        ].join("; "),
      );
    },
  };
}

async function runRemotePython(
  client: AnyHarnessClient,
  workspaceId: string,
  sourceWorkspacePath: string,
  fixturePath: string,
  script: string,
): Promise<void> {
  const result = await client.processes.run(workspaceId, {
    command: ["python3", "-c", script, sourceWorkspacePath, fixturePath],
    cwd: ".",
    timeoutMs: 120_000,
    maxOutputBytes: 1_000_000,
  });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || `remote command failed for ${fixturePath}`);
  }
}

function buildRemoteFixturePath(sourceWorkspacePath: string, name: string): string {
  const sourcePath = path.posix;
  const baseName = sourcePath.basename(sourceWorkspacePath);
  const parent = sourcePath.dirname(sourceWorkspacePath);
  return sourcePath.join(
    parent,
    `${baseName}-${slug(name)}-${randomUUID().slice(0, 8)}`,
  );
}

function slug(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "workspace";
}

async function collectPrompt(
  baseUrl: string,
  authToken: string | undefined,
  sessionId: string,
  text: string,
  options: PromptCollectionOptions = {},
): Promise<PromptResult> {
  const client = new AnyHarnessClient({ baseUrl, authToken });
  const events: SessionEventEnvelope[] = [];
  let closeStream: (() => void) | null = null;
  let settled = false;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const stopWhen = options.stopWhen ?? defaultStopCondition;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  const completed = new Promise<void>((resolve, reject) => {
    const stream = streamSession({
      baseUrl,
      sessionId,
      authToken,
      onEvent: (envelope) => {
        events.push(envelope);
        if (stopWhen(envelope, events)) {
          settled = true;
          stream.close();
          resolve();
        }
      },
      onError: (error) => {
        if (settled) {
          return;
        }
        settled = true;
        reject(error);
      },
      onClose: () => {
        if (settled) {
          return;
        }
        settled = true;
        reject(new Error(`session stream closed before completion in session ${sessionId}`));
      },
    });
    closeStream = () => stream.close();
  });

  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      closeStream?.();
      const lastEnvelope = events.at(-1);
      const lastEventType = lastEnvelope?.event.type ?? "none";
      reject(
        new Error(
          `timed out waiting for prompt completion in session ${sessionId} after ${timeoutMs}ms (events=${events.length}, lastEvent=${lastEventType})`,
        ),
      );
    }, timeoutMs);
  });

  try {
    await Promise.race([
      (async () => {
        await client.sessions.promptText(sessionId, text);
        await completed;
      })(),
      timeout,
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }

  return {
    events,
    transcript: reduceEvents(events, sessionId),
  };
}

function defaultStopCondition(envelope: SessionEventEnvelope): boolean {
  return envelope.event.type === "turn_ended" || envelope.event.type === "session_ended";
}

async function waitForHealth(
  baseUrl: string,
  authToken: string,
  child: ChildProcessWithoutNullStreams,
  stderr: string[],
): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode != null) {
      throw new Error(`anyharness exited early: ${stderr.join("")}`);
    }

    try {
      const response = await fetch(`${baseUrl}/health`, {
        headers: { authorization: `Bearer ${authToken}` },
      });
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`timed out waiting for anyharness health: ${stderr.join("")}`);
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("failed to allocate port"));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on("error", reject);
  });
}

async function onceClosed(child: ChildProcessWithoutNullStreams): Promise<void> {
  await new Promise<void>((resolve) => {
    child.once("close", () => resolve());
  });
}

async function removeRuntimeHome(runtimeHome: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(runtimeHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  if (lastError) {
    throw lastError;
  }
}

function resolveAgentSource(
  configured?: CreateRuntimeHarnessOptions["agentSource"],
): "managed" | "override" {
  const candidate = configured ?? process.env.ANYHARNESS_TEST_AGENT_SOURCE?.trim();
  if (candidate === "override") {
    return "override";
  }
  return "managed";
}
