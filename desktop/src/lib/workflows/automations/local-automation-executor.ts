import type {
  LocalAutomationRunClaimResponse,
  LocalAutomationMutationResponse,
} from "@/lib/access/cloud/client";
import type { AnyHarnessClient, GetSetupStatusResponse, Session, Workspace } from "@anyharness/sdk";
import { AnyHarnessError } from "@anyharness/sdk";
import {
  LOCAL_AUTOMATION_ERROR_CODES,
  shouldUpdateAutomationWorkspaceDisplayName,
  workspaceMatchesAutomationPlan,
  type LocalAutomationRepoCandidate,
  type LocalAutomationWorktreePlan,
} from "@/lib/domain/automations/local-executor";

const AUTOMATION_LOCAL_ORIGIN = { kind: "system", entrypoint: "desktop" } as const;
const SETUP_POLL_INTERVAL_MS = 2_000;
const SETUP_TIMEOUT_MS = 360_000;
const LIVE_CONFIG_POLL_INTERVAL_MS = 1_000;
const LIVE_CONFIG_TIMEOUT_MS = 30_000;

export class LocalAutomationExecutorError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
    this.name = "LocalAutomationExecutorError";
  }
}

export interface LocalAutomationTransitionCallbacks {
  markCreatingWorkspace: () => Promise<LocalAutomationMutationResponse>;
  attachWorkspace: (anyharnessWorkspaceId: string) => Promise<LocalAutomationMutationResponse>;
  markProvisioningWorkspace: () => Promise<LocalAutomationMutationResponse>;
  markCreatingSession: (anyharnessWorkspaceId: string) => Promise<LocalAutomationMutationResponse>;
  attachSession: (
    anyharnessWorkspaceId: string,
    anyharnessSessionId: string,
  ) => Promise<LocalAutomationMutationResponse>;
  markDispatching: () => Promise<LocalAutomationMutationResponse>;
  markDispatched: (
    anyharnessWorkspaceId: string,
    anyharnessSessionId: string,
  ) => Promise<LocalAutomationMutationResponse>;
}

export interface ExecuteLocalAutomationInput {
  client: AnyHarnessClient;
  claim: LocalAutomationRunClaimResponse;
  candidate: LocalAutomationRepoCandidate;
  plan: LocalAutomationWorktreePlan;
  transitions: LocalAutomationTransitionCallbacks;
  shouldContinue?: () => boolean;
}

export async function executeLocalAutomationRun(
  input: ExecuteLocalAutomationInput,
): Promise<void> {
  ensureClaimActive(input);
  const agentKind = input.claim.agentKindSnapshot;
  if (!agentKind) {
    throw new LocalAutomationExecutorError("agent_not_configured");
  }

  const workspace = await createOrReuseWorkspace(input);
  ensureClaimActive(input);
  await prepareWorkspace(input, workspace.id);
  ensureClaimActive(input);
  const session = await createOrReuseSession(input, workspace.id, agentKind);
  ensureClaimActive(input);
  await applyReasoningEffort(
    input.client,
    session.id,
    input.claim.reasoningEffortSnapshot,
    () => isClaimActive(input),
  );
  ensureClaimActive(input);

  const dispatching = await input.transitions.markDispatching();
  if (!dispatching.accepted) {
    return;
  }
  ensureClaimActive(input);
  try {
    await input.client.sessions.promptText(session.id, input.claim.promptSnapshot);
  } catch (error) {
    if (
      error instanceof AnyHarnessError
      && error.problem.status >= 400
      && error.problem.status < 500
    ) {
      throw new LocalAutomationExecutorError(LOCAL_AUTOMATION_ERROR_CODES.promptSendFailed);
    }
    throw new LocalAutomationExecutorError(LOCAL_AUTOMATION_ERROR_CODES.dispatchUncertain);
  }
  try {
    await input.transitions.markDispatched(workspace.id, session.id);
  } catch {
    // The prompt was already accepted. Leave the run in dispatching so the
    // control-plane sweeper can apply dispatch_uncertain instead of marking
    // the accepted run as an executor failure.
  }
}

async function createOrReuseWorkspace(
  input: ExecuteLocalAutomationInput,
): Promise<Workspace> {
  if (input.claim.anyharnessWorkspaceId) {
    const workspace = await getWorkspaceOrFail(input.client, input.claim.anyharnessWorkspaceId);
    assertWorkspaceMatches(input, workspace);
    await syncAutomationWorkspaceDisplayName(input, workspace, { force: false });
    return workspace;
  }

  const creating = await input.transitions.markCreatingWorkspace();
  if (!creating.accepted) {
    throw new LocalAutomationExecutorError("stale_claim");
  }

  const resolved = await resolveExistingTargetPath(input);
  if (resolved) {
    const attached = await input.transitions.attachWorkspace(resolved.id);
    if (!attached.accepted) {
      throw new LocalAutomationExecutorError(LOCAL_AUTOMATION_ERROR_CODES.staleClaim);
    }
    await syncAutomationWorkspaceDisplayName(input, resolved, { force: false });
    return resolved;
  }

  let workspace: Workspace;
  try {
    const response = await input.client.workspaces.createWorktree({
      repoRootId: input.plan.repoRootId,
      newBranchName: input.plan.branchName,
      targetPath: input.plan.targetPath,
      baseBranch: input.plan.baseRef,
      setupScript: input.plan.setupScript,
      origin: AUTOMATION_LOCAL_ORIGIN,
      creatorContext: {
        kind: "automation",
        automationId: input.claim.automationId,
        automationRunId: input.claim.id,
        label: input.claim.titleSnapshot,
      },
    });
    workspace = response.workspace;
  } catch {
    throw new LocalAutomationExecutorError(LOCAL_AUTOMATION_ERROR_CODES.workspaceCreateFailed);
  }

  const attached = await input.transitions.attachWorkspace(workspace.id);
  if (!attached.accepted) {
    throw new LocalAutomationExecutorError(LOCAL_AUTOMATION_ERROR_CODES.staleClaim);
  }
  await syncAutomationWorkspaceDisplayName(input, workspace, { force: true });
  return workspace;
}

async function syncAutomationWorkspaceDisplayName(
  input: ExecuteLocalAutomationInput,
  workspace: Workspace,
  options: { force: boolean },
): Promise<void> {
  if (
    !options.force
    && !shouldUpdateAutomationWorkspaceDisplayName({
      currentDisplayName: workspace.displayName,
      workspaceName: input.plan.workspaceName,
    })
  ) {
    return;
  }

  const updated = await input.client.workspaces.updateDisplayName(workspace.id, {
    displayName: input.plan.displayName,
  }).catch(() => null);
  if (updated) {
    workspace.displayName = updated.displayName;
  }
}

async function resolveExistingTargetPath(
  input: ExecuteLocalAutomationInput,
): Promise<Workspace | null> {
  try {
    const response = await input.client.workspaces.resolveFromPath({ path: input.plan.targetPath });
    const workspace = response.workspace;
    assertWorkspaceMatches(input, workspace);
    return workspace;
  } catch (error) {
    if (error instanceof LocalAutomationExecutorError) {
      throw error;
    }
    return null;
  }
}

async function prepareWorkspace(
  input: ExecuteLocalAutomationInput,
  workspaceId: string,
): Promise<void> {
  const provisioning = await input.transitions.markProvisioningWorkspace();
  if (!provisioning.accepted) {
    throw new LocalAutomationExecutorError(LOCAL_AUTOMATION_ERROR_CODES.staleClaim);
  }
  if (!input.plan.setupScript) {
    return;
  }
  await waitForSetup(
    input.client,
    workspaceId,
    input.plan.setupScript,
    input.plan.baseRef,
    () => isClaimActive(input),
  );
}

async function createOrReuseSession(
  input: ExecuteLocalAutomationInput,
  workspaceId: string,
  agentKind: string,
): Promise<Session> {
  const creating = await input.transitions.markCreatingSession(workspaceId);
  if (!creating.accepted) {
    throw new LocalAutomationExecutorError(LOCAL_AUTOMATION_ERROR_CODES.staleClaim);
  }
  const attachedSessionId = creating.run?.anyharnessSessionId ?? input.claim.anyharnessSessionId;
  if (attachedSessionId) {
    const session = await input.client.sessions.get(attachedSessionId).catch(() => null);
    if (session && session.workspaceId === workspaceId && session.agentKind === agentKind) {
      return session;
    }
    throw new LocalAutomationExecutorError(LOCAL_AUTOMATION_ERROR_CODES.sessionCreateFailed);
  }

  await assertAgentAndModelReady(input.client, workspaceId, agentKind, input.claim.modelIdSnapshot);

  let session: Session;
  try {
    session = await input.client.sessions.create({
      workspaceId,
      agentKind,
      modelId: input.claim.modelIdSnapshot,
      modeId: input.claim.modeIdSnapshot,
      origin: AUTOMATION_LOCAL_ORIGIN,
    });
  } catch {
    throw new LocalAutomationExecutorError(LOCAL_AUTOMATION_ERROR_CODES.sessionCreateFailed);
  }
  const attached = await input.transitions.attachSession(workspaceId, session.id);
  if (!attached.accepted) {
    throw new LocalAutomationExecutorError(LOCAL_AUTOMATION_ERROR_CODES.staleClaim);
  }
  return session;
}

async function assertAgentAndModelReady(
  client: AnyHarnessClient,
  workspaceId: string,
  agentKind: string,
  modelId: string | null,
): Promise<void> {
  const catalog = await client.workspaces.getSessionLaunchCatalog(workspaceId).catch(() => null);
  const agent = catalog?.agents.find((candidate) => candidate.kind === agentKind);
  if (!agent) {
    throw new LocalAutomationExecutorError(LOCAL_AUTOMATION_ERROR_CODES.agentNotReady);
  }
  if (modelId && !agent.models.some((model) => model.id === modelId)) {
    throw new LocalAutomationExecutorError(LOCAL_AUTOMATION_ERROR_CODES.agentNotReady);
  }
}

async function applyReasoningEffort(
  client: AnyHarnessClient,
  sessionId: string,
  reasoningEffort: string | null,
  shouldContinue: () => boolean,
): Promise<void> {
  if (!reasoningEffort) {
    return;
  }
  const deadline = Date.now() + LIVE_CONFIG_TIMEOUT_MS;
  let attemptedApply = false;
  while (Date.now() < deadline) {
    if (!shouldContinue()) {
      throw new LocalAutomationExecutorError(LOCAL_AUTOMATION_ERROR_CODES.staleClaim);
    }
    const response = await client.sessions.getLiveConfig(sessionId).catch(() => null);
    const effort = response?.liveConfig?.normalizedControls.effort ?? null;
    if (!effort) {
      await delay(LIVE_CONFIG_POLL_INTERVAL_MS);
      continue;
    }
    if (effort.currentValue === reasoningEffort) {
      return;
    }
    if (!effort.values.some((value) => value.value === reasoningEffort)) {
      throw new LocalAutomationExecutorError(LOCAL_AUTOMATION_ERROR_CODES.configApplyFailed);
    }
    if (attemptedApply) {
      await delay(LIVE_CONFIG_POLL_INTERVAL_MS);
      continue;
    }
    const result = await client.sessions.setConfigOption(sessionId, {
      configId: effort.rawConfigId,
      value: reasoningEffort,
    }).catch(() => null);
    if (!result) {
      throw new LocalAutomationExecutorError(LOCAL_AUTOMATION_ERROR_CODES.configApplyFailed);
    }
    if (result.applyState === "applied") {
      return;
    }
    if (result.applyState !== "queued") {
      throw new LocalAutomationExecutorError(LOCAL_AUTOMATION_ERROR_CODES.configApplyFailed);
    }
    attemptedApply = true;
    await delay(LIVE_CONFIG_POLL_INTERVAL_MS);
  }
  throw new LocalAutomationExecutorError(LOCAL_AUTOMATION_ERROR_CODES.configApplyFailed);
}

async function waitForSetup(
  client: AnyHarnessClient,
  workspaceId: string,
  command: string,
  baseRef: string,
  shouldContinue: () => boolean,
): Promise<void> {
  const deadline = Date.now() + SETUP_TIMEOUT_MS;
  let restartedAfterMissingStatus = false;
  while (Date.now() < deadline) {
    if (!shouldContinue()) {
      throw new LocalAutomationExecutorError(LOCAL_AUTOMATION_ERROR_CODES.staleClaim);
    }
    const setupStatus = await getSetupStatus(client, workspaceId);
    if (setupStatus.kind === "unavailable") {
      await delay(SETUP_POLL_INTERVAL_MS);
      continue;
    }
    if (setupStatus.kind === "missing") {
      if (!restartedAfterMissingStatus) {
        try {
          await client.workspaces.startSetup(workspaceId, { command, baseRef });
          restartedAfterMissingStatus = true;
        } catch {
          await delay(SETUP_POLL_INTERVAL_MS);
          continue;
        }
      }
      await delay(SETUP_POLL_INTERVAL_MS);
      continue;
    }
    const { status } = setupStatus;
    if (status.status === "succeeded") {
      return;
    }
    if (status.status === "failed") {
      throw new LocalAutomationExecutorError(LOCAL_AUTOMATION_ERROR_CODES.workspaceSetupFailed);
    }
    await delay(SETUP_POLL_INTERVAL_MS);
  }
  throw new LocalAutomationExecutorError(LOCAL_AUTOMATION_ERROR_CODES.workspaceSetupFailed);
}

type SetupStatusLookup =
  | { kind: "found"; status: GetSetupStatusResponse }
  | { kind: "missing" }
  | { kind: "unavailable" };

async function getSetupStatus(
  client: AnyHarnessClient,
  workspaceId: string,
): Promise<SetupStatusLookup> {
  try {
    return { kind: "found", status: await client.workspaces.getSetupStatus(workspaceId) };
  } catch (error) {
    if (
      error instanceof AnyHarnessError
      && (error.problem.status === 404 || error.problem.code === "SETUP_NOT_FOUND")
    ) {
      return { kind: "missing" };
    }
    return { kind: "unavailable" };
  }
}

async function getWorkspaceOrFail(client: AnyHarnessClient, workspaceId: string): Promise<Workspace> {
  try {
    return await client.workspaces.get(workspaceId);
  } catch {
    throw new LocalAutomationExecutorError(LOCAL_AUTOMATION_ERROR_CODES.workspaceCreateFailed);
  }
}

function assertWorkspaceMatches(input: ExecuteLocalAutomationInput, workspace: Workspace): void {
  if (!workspaceMatchesAutomationPlan({
    workspace,
    repoRoot: input.candidate.repoRoot,
    plan: input.plan,
    claim: input.claim,
  })) {
    throw new LocalAutomationExecutorError(LOCAL_AUTOMATION_ERROR_CODES.workspaceCreateFailed);
  }
}

function isClaimActive(input: ExecuteLocalAutomationInput): boolean {
  return input.shouldContinue?.() ?? true;
}

function ensureClaimActive(input: ExecuteLocalAutomationInput): void {
  if (!isClaimActive(input)) {
    throw new LocalAutomationExecutorError(LOCAL_AUTOMATION_ERROR_CODES.staleClaim);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
