import { readPersistedValue, persistValue } from "@/lib/infra/persistence/preferences-persistence";

const SSH_DIRECT_TARGET_PROFILES_KEY = "ssh_direct_target_profiles";
const DEFAULT_SSH_PORT = 22;
const DEFAULT_ANYHARNESS_PORT = 8457;

export interface SshDirectTargetProfile {
  targetId: string;
  sshHost: string;
  sshUser: string;
  sshPort: number;
  identityFile?: string | null;
  remoteAnyHarnessPort: number;
}

function normalizedPort(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 65_535
    ? value
    : fallback;
}

function normalizeProfile(input: unknown): SshDirectTargetProfile | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }
  const record = input as Record<string, unknown>;
  const targetId = typeof record.targetId === "string" ? record.targetId.trim() : "";
  const sshHost = typeof record.sshHost === "string" ? record.sshHost.trim() : "";
  const sshUser = typeof record.sshUser === "string" ? record.sshUser.trim() : "";
  if (!targetId || !sshHost || !sshUser) {
    return null;
  }
  const identityFile = typeof record.identityFile === "string"
    ? record.identityFile.trim()
    : "";
  return {
    targetId,
    sshHost,
    sshUser,
    sshPort: normalizedPort(record.sshPort, DEFAULT_SSH_PORT),
    identityFile: identityFile || null,
    remoteAnyHarnessPort: normalizedPort(
      record.remoteAnyHarnessPort,
      DEFAULT_ANYHARNESS_PORT,
    ),
  };
}

async function readProfiles(): Promise<Record<string, SshDirectTargetProfile>> {
  const persisted = await readPersistedValue<Record<string, unknown>>(
    SSH_DIRECT_TARGET_PROFILES_KEY,
  );
  if (!persisted || typeof persisted !== "object" || Array.isArray(persisted)) {
    return {};
  }
  const profiles: Record<string, SshDirectTargetProfile> = {};
  for (const value of Object.values(persisted)) {
    const profile = normalizeProfile(value);
    if (profile) {
      profiles[profile.targetId] = profile;
    }
  }
  return profiles;
}

export async function getSshDirectTargetProfile(
  targetId: string,
): Promise<SshDirectTargetProfile | null> {
  const profiles = await readProfiles();
  return profiles[targetId] ?? null;
}

export async function setSshDirectTargetProfile(
  profile: SshDirectTargetProfile,
): Promise<void> {
  const normalized = normalizeProfile(profile);
  if (!normalized) {
    throw new Error("SSH host and user are required for direct target access.");
  }
  const profiles = await readProfiles();
  profiles[normalized.targetId] = normalized;
  await persistValue(SSH_DIRECT_TARGET_PROFILES_KEY, profiles);
}

export async function deleteSshDirectTargetProfile(targetId: string): Promise<void> {
  const profiles = await readProfiles();
  delete profiles[targetId];
  await persistValue(SSH_DIRECT_TARGET_PROFILES_KEY, profiles);
}
