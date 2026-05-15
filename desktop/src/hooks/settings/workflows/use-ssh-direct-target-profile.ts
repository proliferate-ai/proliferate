import { useCallback, useEffect, useState } from "react";
import {
  getSshDirectTargetProfile,
  setSshDirectTargetProfile,
  type SshDirectTargetProfile,
} from "@/lib/access/tauri/ssh-target-profile";

export function useSshDirectTargetProfile(targetId: string | null | undefined) {
  const [profile, setProfile] = useState<SshDirectTargetProfile | null>(null);
  const [loading, setLoading] = useState(false);

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

  return {
    profile,
    loading,
    reload,
    saveProfile,
  };
}
