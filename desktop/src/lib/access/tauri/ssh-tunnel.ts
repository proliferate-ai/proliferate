import { invoke } from "@tauri-apps/api/core";

export interface EnsureSshAnyHarnessTunnelInput {
  targetId: string;
  sshHost: string;
  sshUser: string;
  sshPort?: number | null;
  identityFile?: string | null;
  remoteAnyHarnessPort?: number | null;
}

export interface EnsureSshAnyHarnessTunnelResult {
  localUrl: string;
  localPort: number;
}

export async function ensureSshAnyHarnessTunnel(
  input: EnsureSshAnyHarnessTunnelInput,
): Promise<EnsureSshAnyHarnessTunnelResult> {
  return await invoke<EnsureSshAnyHarnessTunnelResult>(
    "ensure_ssh_anyharness_tunnel",
    { input },
  );
}
