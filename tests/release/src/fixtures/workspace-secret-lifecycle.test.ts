import assert from "node:assert/strict";
import { test } from "node:test";

import type { RunIdentityV1 } from "../runner/identity.js";
import {
  runScopedWorkspaceSecretPath,
  withWorkspaceSecretLifecycle,
  type WorkspaceSecretLifecycleClient,
} from "./workspace-secret-lifecycle.js";

const run: RunIdentityV1 = {
  run_id: "run-1",
  shard_id: "sandbox-1",
  attempt: 2,
  source_sha: "a".repeat(40),
  origin: { kind: "local", github_run_id: null, github_job: null },
};

class FakeClient implements WorkspaceSecretLifecycleClient {
  readonly events: string[];
  secretExists = false;
  workspaceExists = false;
  failSecretDelete = false;
  failWorkspaceDelete = false;

  constructor(events: string[]) {
    this.events = events;
  }

  async put<TResponse>(path: string, body: unknown): Promise<TResponse> {
    const secretPath = (body as { path: string }).path;
    this.events.push(`put:${path}:${secretPath}`);
    this.secretExists = true;
    return { materialization: { status: "pending" } } as TResponse;
  }

  async post<TResponse>(path: string): Promise<TResponse> {
    this.events.push(`post:${path}`);
    this.workspaceExists = true;
    return { id: "workspace-1", status: "materializing" } as TResponse;
  }

  async delete<TResponse>(path: string, body?: unknown): Promise<TResponse> {
    if (path.includes("/secrets/files")) {
      this.events.push(`delete-secret:${(body as { path: string }).path}`);
      if (this.failSecretDelete) {
        throw new Error("secret delete failed");
      }
      this.secretExists = false;
      return undefined as TResponse;
    }
    this.events.push(`delete-workspace:${path}`);
    if (this.failWorkspaceDelete) {
      throw new Error("workspace delete failed");
    }
    this.workspaceExists = false;
    return undefined as TResponse;
  }
}

function lifecycleOptions(client: FakeClient, events: string[], exercise: () => Promise<string>) {
  const secretPath = runScopedWorkspaceSecretPath(run);
  return {
    client,
    owner: "example",
    repo: "fixture",
    secretPath,
    secretContent: "synthetic-secret",
    workspaceRequest: { branchName: "run-branch" },
    exercise: async () => exercise(),
    verifySecretAbsent: async () => {
      events.push("verify-secret-absent");
      if (client.secretExists) {
        throw new Error("secret remained materialized");
      }
    },
  };
}

test("run-scoped path is stable for one attempt and distinct across attempts", () => {
  const path = runScopedWorkspaceSecretPath(run);
  assert.match(path, /^\.proliferate\/qualification\/t3-sec-mat-1-[0-9a-f]{20}\.txt$/);
  assert.equal(path, runScopedWorkspaceSecretPath(run));
  assert.notEqual(path, runScopedWorkspaceSecretPath({ ...run, attempt: run.attempt + 1 }));
});

test("lifecycle cleans the secret before the workspace after a successful proof", async () => {
  const events: string[] = [];
  const client = new FakeClient(events);
  const result = await withWorkspaceSecretLifecycle(
    lifecycleOptions(client, events, async () => {
      events.push("exercise");
      return "proved";
    }),
  );

  assert.equal(result, "proved");
  assert.equal(client.secretExists, false);
  assert.equal(client.workspaceExists, false);
  assert.deepEqual(events.slice(0, 2), [
    `put:/v1/cloud/repos/example/fixture/secrets/files:${runScopedWorkspaceSecretPath(run)}`,
    "post:/v1/cloud/workspaces",
  ]);
  assert.deepEqual(events.slice(-3), [
    `delete-secret:${runScopedWorkspaceSecretPath(run)}`,
    "verify-secret-absent",
    "delete-workspace:/v1/cloud/workspaces/workspace-1",
  ]);
});

test("lifecycle cleans both resources after the proof assertion fails", async () => {
  const events: string[] = [];
  const client = new FakeClient(events);
  const primary = new Error("byte proof failed");

  await assert.rejects(
    withWorkspaceSecretLifecycle(
      lifecycleOptions(client, events, async () => {
        throw primary;
      }),
    ),
    (error) => error === primary,
  );
  assert.equal(client.secretExists, false);
  assert.equal(client.workspaceExists, false);
  assert.ok(events.includes("verify-secret-absent"));
});

test("cleanup failures are non-green and preserve the primary plus every cleanup error", async () => {
  const events: string[] = [];
  const client = new FakeClient(events);
  client.failSecretDelete = true;
  client.failWorkspaceDelete = true;

  await assert.rejects(
    withWorkspaceSecretLifecycle(
      lifecycleOptions(client, events, async () => {
        throw new Error("byte proof failed");
      }),
    ),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(
        error.errors.map((entry) => (entry as Error).message),
        [
          "byte proof failed",
          "T3-SEC-MAT-1 cleanup failed to delete workspace secret: secret delete failed",
          "T3-SEC-MAT-1 cleanup failed to verify workspace secret absence: secret remained materialized",
          "T3-SEC-MAT-1 cleanup failed to delete cloud workspace: workspace delete failed",
        ],
      );
      return true;
    },
  );
  assert.ok(events.some((event) => event.startsWith("delete-workspace:")));
});
