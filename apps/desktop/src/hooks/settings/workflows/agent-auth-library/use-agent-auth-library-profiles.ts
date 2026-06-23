import { useEffect, useRef, useState } from "react";
import type { SandboxProfile } from "@proliferate/cloud-sdk";

interface AgentAuthLibraryProfilesOptions {
  autoLoadPersonalProfile: boolean;
  ensurePersonalProfile: () => Promise<SandboxProfile>;
  setFeedback: (feedback: string | null) => void;
}

export function useAgentAuthLibraryProfiles({
  autoLoadPersonalProfile,
  ensurePersonalProfile,
  setFeedback,
}: AgentAuthLibraryProfilesOptions) {
  const [personalProfile, setPersonalProfile] = useState<SandboxProfile | null>(null);
  const [personalProfileLoading, setPersonalProfileLoading] = useState(false);
  const autoLoadedPersonalProfileRef = useRef(false);

  useEffect(() => {
    if (
      !autoLoadPersonalProfile
      || personalProfile !== null
      || autoLoadedPersonalProfileRef.current
    ) {
      return;
    }

    let cancelled = false;
    autoLoadedPersonalProfileRef.current = true;
    setPersonalProfileLoading(true);
    void ensurePersonalProfile()
      .then((nextProfile) => {
        if (!cancelled) {
          setPersonalProfile(nextProfile);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          autoLoadedPersonalProfileRef.current = false;
          setFeedback(error instanceof Error
            ? error.message
            : "Could not load personal cloud defaults.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPersonalProfileLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [autoLoadPersonalProfile, ensurePersonalProfile, personalProfile]);

  return {
    personalProfile,
    setPersonalProfile,
    personalProfileLoading,
  };
}
