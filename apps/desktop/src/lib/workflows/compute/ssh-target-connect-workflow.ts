import type {
  CloudTargetDetail,
  CloudTargetEnrollmentRequest,
  CloudTargetEnrollmentResponse,
  CloudTargetExistingEnrollmentRequest,
} from "@proliferate/cloud-sdk";
import type {
  EnsureSshAnyHarnessTunnelResult,
  InstallSshTargetRuntimeInput,
  ProbeSshTargetConnectionInput,
} from "@/lib/access/tauri/ssh-tunnel";
import type { SshDirectTargetProfile } from "@/lib/access/tauri/ssh-target-profile";
import type { ComputeTargetAppearancePreference } from "@/lib/domain/compute/target-appearance";

export type SshTargetConnectPhase =
  | "idle"
  | "checking_ssh"
  | "creating_enrollment"
  | "saving_profile"
  | "installing_runtime"
  | "waiting_for_worker"
  | "verifying_desktop_access"
  | "connected"
  | "failed";

export interface SshTargetConnectPhaseState {
  phase: SshTargetConnectPhase;
  label: string;
}

export interface SshTargetConnectInput {
  existingTargetId?: string | null;
  createRequest: CloudTargetEnrollmentRequest;
  existingEnrollmentRequest?: CloudTargetExistingEnrollmentRequest;
  directAccess: SshDirectTargetProfile;
  appearance?: ComputeTargetAppearancePreference | null;
  cloudBaseUrl: string;
}

export interface SshTargetConnectResult {
  enrollment: CloudTargetEnrollmentResponse;
  manualInstallCommand: string;
  target: CloudTargetDetail;
  tunnel: EnsureSshAnyHarnessTunnelResult | null;
}

export interface SshTargetConnectDeps {
  createTargetEnrollment(input: CloudTargetEnrollmentRequest): Promise<CloudTargetEnrollmentResponse>;
  createExistingTargetEnrollment(
    targetId: string,
    input: CloudTargetExistingEnrollmentRequest,
  ): Promise<CloudTargetEnrollmentResponse>;
  saveDirectProfile(profile: SshDirectTargetProfile): Promise<void>;
  saveAppearance(preference: ComputeTargetAppearancePreference): Promise<void>;
  probeSsh(input: ProbeSshTargetConnectionInput): Promise<unknown>;
  installRuntime(input: InstallSshTargetRuntimeInput): Promise<unknown>;
  getTarget(targetId: string): Promise<CloudTargetDetail>;
  verifyTunnel(profile: SshDirectTargetProfile): Promise<EnsureSshAnyHarnessTunnelResult>;
  onPhase?(state: SshTargetConnectPhaseState): void;
  onEnrollment?(enrollment: CloudTargetEnrollmentResponse, manualInstallCommand: string): void;
  sleep?(ms: number): Promise<void>;
  now?(): number;
}

const WORKER_WAIT_TIMEOUT_MS = 120_000;
const WORKER_WAIT_INTERVAL_MS = 2_500;

const PHASE_LABELS: Record<SshTargetConnectPhase, string> = {
  idle: "Ready",
  checking_ssh: "Checking SSH access",
  creating_enrollment: "Creating Cloud target",
  saving_profile: "Saving local SSH profile",
  installing_runtime: "Installing Proliferate runtime",
  waiting_for_worker: "Waiting for worker enrollment",
  verifying_desktop_access: "Verifying Desktop access",
  connected: "Connected",
  failed: "Needs attention",
};

export function buildSshTargetManualInstallCommand(
  installCommand: string,
  remoteAnyHarnessPort: number | null | undefined,
): string {
  const port = validPortOrDefault(remoteAnyHarnessPort, 8457);
  return [
    `PROLIFERATE_ANYHARNESS_PORT=${shellQuote(String(port))}`,
    `PROLIFERATE_ANYHARNESS_BASE_URL=${shellQuote(`http://127.0.0.1:${port}`)}`,
    "sh",
    "-c",
    shellQuote(installCommand),
  ].join(" ");
}

export async function runSshTargetConnectWorkflow(
  input: SshTargetConnectInput,
  deps: SshTargetConnectDeps,
): Promise<SshTargetConnectResult> {
  const setPhase = (phase: SshTargetConnectPhase) => {
    deps.onPhase?.({ phase, label: PHASE_LABELS[phase] });
  };

  try {
    setPhase("checking_ssh");
    await deps.probeSsh({
      sshHost: input.directAccess.sshHost,
      sshUser: input.directAccess.sshUser,
      sshPort: input.directAccess.sshPort,
      identityFile: input.directAccess.identityFile,
    });

    setPhase("creating_enrollment");
    const enrollment = input.existingTargetId
      ? await deps.createExistingTargetEnrollment(
        input.existingTargetId,
        input.existingEnrollmentRequest ?? {},
      )
      : await deps.createTargetEnrollment(input.createRequest);
    const manualInstallCommand = buildSshTargetManualInstallCommand(
      enrollment.installCommand,
      input.directAccess.remoteAnyHarnessPort,
    );
    deps.onEnrollment?.(enrollment, manualInstallCommand);

    const profile = {
      ...input.directAccess,
      targetId: enrollment.target.id,
      anyharnessBearerToken: enrollment.anyharnessBearerToken,
    };

    setPhase("saving_profile");
    await deps.saveDirectProfile(profile);
    if (input.appearance) {
      await deps.saveAppearance({
        ...input.appearance,
        targetId: enrollment.target.id,
      });
    }

    setPhase("installing_runtime");
    await deps.installRuntime({
      sshHost: profile.sshHost,
      sshUser: profile.sshUser,
      sshPort: profile.sshPort,
      identityFile: profile.identityFile,
      remoteAnyHarnessPort: profile.remoteAnyHarnessPort,
      cloudBaseUrl: input.cloudBaseUrl,
      enrollmentToken: enrollment.enrollmentToken,
      anyharnessBearerToken: enrollment.anyharnessBearerToken,
      artifactBaseUrl: enrollment.artifactBaseUrl ?? null,
    });

    setPhase("waiting_for_worker");
    const target = await waitForWorker(
      enrollment.target.id,
      deps,
      input.existingTargetId ? workerSignalBaseline(enrollment.target) : null,
    );

    setPhase("verifying_desktop_access");
    const tunnel = await verifyTunnel(profile, input.createRequest.ownerScope, deps);

    setPhase("connected");
    return { enrollment, manualInstallCommand, target, tunnel };
  } catch (error) {
    setPhase("failed");
    throw error;
  }
}

async function verifyTunnel(
  profile: SshDirectTargetProfile,
  ownerScope: CloudTargetEnrollmentRequest["ownerScope"],
  deps: SshTargetConnectDeps,
): Promise<EnsureSshAnyHarnessTunnelResult | null> {
  try {
    return await deps.verifyTunnel(profile);
  } catch (error) {
    if (ownerScope === "organization") {
      return null;
    }
    throw error;
  }
}

async function waitForWorker(
  targetId: string,
  deps: SshTargetConnectDeps,
  baseline: WorkerSignalBaseline | null,
): Promise<CloudTargetDetail> {
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const deadline = now() + WORKER_WAIT_TIMEOUT_MS;
  let latest: CloudTargetDetail | null = null;

  while (now() < deadline) {
    latest = await deps.getTarget(targetId);
    if (isWorkerConnected(latest, baseline)) {
      return latest;
    }
    await sleep(WORKER_WAIT_INTERVAL_MS);
  }

  throw new Error(
    latest?.status === "degraded"
      ? "The worker enrolled, but the runtime reported a degraded state."
      : "Timed out waiting for the target worker to enroll.",
  );
}

interface WorkerSignalBaseline {
  workerId: string | null;
  readyAt: number | null;
}

interface WorkerSignalTarget {
  status?: string | null;
  statusDetail?: {
    lastHeartbeatAt?: string | null;
    updatedAt?: string | null;
  } | null;
  update?: {
    currentVersions?: {
      workerId?: string | null;
      reportedAt?: string | null;
    } | null;
  } | null;
}

function isWorkerConnected(
  target: WorkerSignalTarget,
  baseline: WorkerSignalBaseline | null,
): boolean {
  const workerId = target.update?.currentVersions?.workerId ?? null;
  const connected = Boolean(
    workerId
      || target.status === "online"
      || target.status === "degraded",
  );
  if (!connected) {
    return false;
  }
  if (baseline === null) {
    return true;
  }
  if (baseline.workerId) {
    return Boolean(workerId && workerId !== baseline.workerId);
  }
  const readyAt = workerSignalTimestamp(target);
  return baseline.readyAt !== null && readyAt !== null && readyAt > baseline.readyAt;
}

function workerSignalBaseline(target: WorkerSignalTarget): WorkerSignalBaseline {
  return {
    workerId: target.update?.currentVersions?.workerId ?? null,
    readyAt: workerSignalTimestamp(target),
  };
}

function workerSignalTimestamp(target: WorkerSignalTarget): number | null {
  return newestTimestamp(
    target.update?.currentVersions?.reportedAt,
    target.statusDetail?.lastHeartbeatAt,
    target.statusDetail?.updatedAt,
  );
}

function newestTimestamp(...values: Array<string | null | undefined>): number | null {
  const timestamps = values
    .map((value) => value ? Date.parse(value) : Number.NaN)
    .filter(Number.isFinite);
  return timestamps.length > 0 ? Math.max(...timestamps) : null;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function validPortOrDefault(value: number | null | undefined, fallback: number): number {
  return typeof value === "number"
    && Number.isInteger(value)
    && value > 0
    && value <= 65_535
    ? value
    : fallback;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}
