import { invoke } from "@tauri-apps/api/core";

export interface EnsureSshAnyHarnessTunnelInput {
  targetId: string;
  sshHost: string;
  sshUser: string;
  sshPort?: number | null;
  identityFile?: string | null;
  remoteAnyHarnessPort?: number | null;
  anyharnessBearerToken?: string | null;
}

export interface ProbeSshTargetConnectionInput {
  sshHost: string;
  sshUser: string;
  sshPort?: number | null;
  identityFile?: string | null;
}

export interface ProbeSshTargetConnectionResult {
  ok: boolean;
}

export interface InstallSshTargetRuntimeInput extends ProbeSshTargetConnectionInput {
  remoteAnyHarnessPort?: number | null;
  cloudBaseUrl: string;
  enrollmentToken: string;
  anyharnessBearerToken?: string | null;
  artifactBaseUrl?: string | null;
}

export interface InstallSshTargetRuntimeResult {
  stdout: string;
  stderr: string;
}

export interface EnsureSshAnyHarnessTunnelResult {
  localUrl: string;
  localPort: number;
}

export async function probeSshTargetConnection(
  input: ProbeSshTargetConnectionInput,
): Promise<ProbeSshTargetConnectionResult> {
  return await invoke<ProbeSshTargetConnectionResult>(
    "probe_ssh_target_connection",
    { input },
  );
}

export async function installSshTargetRuntime(
  input: InstallSshTargetRuntimeInput,
): Promise<InstallSshTargetRuntimeResult> {
  return await invoke<InstallSshTargetRuntimeResult>(
    "install_ssh_target_runtime",
    { input },
  );
}

export async function ensureSshAnyHarnessTunnel(
  input: EnsureSshAnyHarnessTunnelInput,
): Promise<EnsureSshAnyHarnessTunnelResult> {
  return await invoke<EnsureSshAnyHarnessTunnelResult>(
    "ensure_ssh_anyharness_tunnel",
    { input },
  );
}
