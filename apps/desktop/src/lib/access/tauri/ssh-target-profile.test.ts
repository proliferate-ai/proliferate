import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSshDirectTargetProfile,
  setSshDirectTargetProfile,
  type SshDirectTargetProfile,
} from "./ssh-target-profile";

const storeMocks = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  const get = vi.fn(async (key: string) => values.get(key));
  const set = vi.fn(async (key: string, value: unknown) => {
    values.set(key, value);
  });

  return {
    values,
    get,
    set,
    getPreferencesStore: vi.fn(async () => ({ get, set })),
  };
});

vi.mock("@/lib/access/tauri/store", () => ({
  getPreferencesStore: storeMocks.getPreferencesStore,
}));

const profile = (
  overrides: Partial<SshDirectTargetProfile> = {},
): SshDirectTargetProfile => ({
  targetId: "target-1",
  sshHost: "box.example.com",
  sshUser: "ubuntu",
  sshPort: 22,
  identityFile: "~/.ssh/id_ed25519",
  remoteAnyHarnessPort: 18457,
  workspaceRoot: null,
  ...overrides,
});

describe("setSshDirectTargetProfile", () => {
  beforeEach(() => {
    storeMocks.values.clear();
  });

  it("stores and returns the runtime bearer", async () => {
    const stored = await setSshDirectTargetProfile(
      profile({ anyharnessBearerToken: "runtime-bearer" }),
    );
    expect(stored.anyharnessBearerToken).toBe("runtime-bearer");
    const loaded = await getSshDirectTargetProfile("target-1");
    expect(loaded?.anyharnessBearerToken).toBe("runtime-bearer");
  });

  it("preserves the stored bearer when a connection edit omits it", async () => {
    await setSshDirectTargetProfile(
      profile({ anyharnessBearerToken: "runtime-bearer" }),
    );
    const stored = await setSshDirectTargetProfile(
      profile({ sshHost: "renamed.example.com" }),
    );
    expect(stored.sshHost).toBe("renamed.example.com");
    expect(stored.anyharnessBearerToken).toBe("runtime-bearer");
    const loaded = await getSshDirectTargetProfile("target-1");
    expect(loaded?.anyharnessBearerToken).toBe("runtime-bearer");
  });

  it("normalizes a missing bearer to null", async () => {
    const stored = await setSshDirectTargetProfile(profile());
    expect(stored.anyharnessBearerToken).toBeNull();
  });
});
