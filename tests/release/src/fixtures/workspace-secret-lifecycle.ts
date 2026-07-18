import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import type { RunIdentityV1 } from "../runner/identity.js";

interface MaterializationResponse {
  materialization: { status: "pending" | "running" | "ready" | "error" } | null;
}

export interface WorkspaceSecretLifecycleClient {
  put<TResponse>(path: string, body: unknown): Promise<TResponse>;
  post<TResponse>(path: string, body: unknown): Promise<TResponse>;
  delete<TResponse>(path: string, body?: unknown): Promise<TResponse>;
}

interface WorkspaceResponse {
  id: string;
  status: string;
}

export interface WorkspaceSecretLifecycleOptions<TResult> {
  client: WorkspaceSecretLifecycleClient;
  owner: string;
  repo: string;
  secretPath: string;
  secretContent: string;
  workspaceRequest: Record<string, unknown>;
  exercise(workspace: WorkspaceResponse): Promise<TResult>;
  verifySecretAbsent(): Promise<void>;
}

/** A bounded repo-relative target unique to one run, shard, and attempt. */
export function runScopedWorkspaceSecretPath(run: RunIdentityV1): string {
  const identity = `${run.run_id}:${run.shard_id}:${run.attempt}`;
  const suffix = createHash("sha256").update(identity, "utf8").digest("hex").slice(0, 20);
  return `.proliferate/qualification/t3-sec-mat-1-${suffix}.txt`;
}

/**
 * Owns the scenario's repo secret and workspace as one fail-aware lifecycle.
 * Cleanup never masks the primary failure and every cleanup failure makes the
 * scenario non-green.
 */
export async function withWorkspaceSecretLifecycle<TResult>(
  options: WorkspaceSecretLifecycleOptions<TResult>,
): Promise<TResult> {
  const secretEndpoint = `/v1/cloud/repos/${options.owner}/${options.repo}/secrets/files`;
  let secretCreated = false;
  let workspace: WorkspaceResponse | null = null;
  let result: TResult | undefined;
  let primaryError: unknown;
  let hasPrimaryError = false;

  try {
    const secretPut = await options.client.put<MaterializationResponse>(secretEndpoint, {
      path: options.secretPath,
      content: options.secretContent,
    });
    secretCreated = true;
    assert.ok(
      secretPut.materialization && ["pending", "running", "ready"].includes(secretPut.materialization.status),
      "T3-SEC-MAT-1: PUT workspace file secret must return a materialization status",
    );

    workspace = await options.client.post<WorkspaceResponse>("/v1/cloud/workspaces", options.workspaceRequest);
    result = await options.exercise(workspace);
  } catch (error) {
    hasPrimaryError = true;
    primaryError = error;
  }

  const cleanupErrors: Error[] = [];
  if (secretCreated) {
    await captureCleanupError(cleanupErrors, "delete workspace secret", () =>
      options.client.delete(secretEndpoint, { path: options.secretPath }),
    );
    await captureCleanupError(cleanupErrors, "verify workspace secret absence", options.verifySecretAbsent);
  }
  if (workspace !== null) {
    const workspaceId = workspace.id;
    await captureCleanupError(cleanupErrors, "delete cloud workspace", () =>
      options.client.delete(`/v1/cloud/workspaces/${workspaceId}`),
    );
  }

  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      hasPrimaryError ? [primaryError, ...cleanupErrors] : cleanupErrors,
      "T3-SEC-MAT-1: scenario or cleanup failed",
    );
  }
  if (hasPrimaryError) {
    throw primaryError;
  }
  return result as TResult;
}

async function captureCleanupError(errors: Error[], label: string, cleanup: () => Promise<unknown>): Promise<void> {
  try {
    await cleanup();
  } catch (error) {
    errors.push(
      new Error(`T3-SEC-MAT-1 cleanup failed to ${label}: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      }),
    );
  }
}
