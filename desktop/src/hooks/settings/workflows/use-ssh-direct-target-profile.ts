import { useCallback, useEffect, useState } from "react";
import { ensureSshAnyHarnessTunnel } from "@/lib/access/tauri/ssh-tunnel";
import type { ComputeTargetAppearancePreference } from "@/lib/domain/compute/target-appearance";
import {
  getComputeTargetAppearancePreferences,
  getSshDirectTargetProfile,
  setComputeTargetAppearancePreference,
  setSshDirectTargetProfile,
  type SshDirectTargetProfile,
} from "@/lib/access/tauri/ssh-target-profile";

export function useSshDirectTargetProfile(targetId: string | null | undefined) {
  const [profile, setProfile] = useState<SshDirectTargetProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);

  const reload = useCallback(async () => {
    if (!targetId) {
      setProfile(null);
      return;
    }
    setLoading(true);
    try {
      setProfile(await getSshDirectTargetProfile(targetId));
    } finally {
      setLoading(false);
    }
  }, [targetId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const saveProfile = useCallback(async (next: SshDirectTargetProfile) => {
    await setSshDirectTargetProfile(next);
    setProfile(next);
  }, []);

  const testConnection = useCallback(async (next: SshDirectTargetProfile) => {
    setTesting(true);
    try {
      return await ensureSshAnyHarnessTunnel({
        targetId: next.targetId,
        sshHost: next.sshHost,
        sshUser: next.sshUser,
        sshPort: next.sshPort,
        identityFile: next.identityFile ?? null,
        remoteAnyHarnessPort: next.remoteAnyHarnessPort,
      });
    } finally {
      setTesting(false);
    }
  }, []);

  return {
    profile,
    loading,
    testing,
    reload,
    saveProfile,
    testConnection,
  };
}

export function useComputeTargetAppearancePreferences() {
  const [preferences, setPreferences] = useState<
    Record<string, ComputeTargetAppearancePreference>
  >({});
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setPreferences(await getComputeTargetAppearancePreferences());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const savePreference = useCallback(async (
    preference: ComputeTargetAppearancePreference,
  ) => {
    await setComputeTargetAppearancePreference(preference);
    setPreferences((current) => ({
      ...current,
      [preference.targetId]: preference,
    }));
  }, []);

  return {
    preferences,
    loading,
    reload,
    savePreference,
  };
}
