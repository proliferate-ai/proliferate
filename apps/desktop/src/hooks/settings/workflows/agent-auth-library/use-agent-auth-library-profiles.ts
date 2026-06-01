import { useEffect, useRef, useState } from "react";
import type { SandboxProfile } from "@proliferate/cloud-sdk";

interface AgentAuthLibraryProfilesOptions {
  autoLoadPersonalProfile: boolean;
  initialOrganizationId: string | null;
  selectedOrganizationId: string | null;
  ensureOrganizationProfile: (input: { organizationId: string }) => Promise<SandboxProfile>;
  ensurePersonalProfile: () => Promise<SandboxProfile>;
  setFeedback: (feedback: string | null) => void;
}

export function useAgentAuthLibraryProfiles({
  autoLoadPersonalProfile,
  initialOrganizationId,
  selectedOrganizationId,
  ensureOrganizationProfile,
  ensurePersonalProfile,
  setFeedback,
}: AgentAuthLibraryProfilesOptions) {
  const [organizationProfile, setOrganizationProfile] = useState<SandboxProfile | null>(null);
  const [personalProfile, setPersonalProfile] = useState<SandboxProfile | null>(null);
  const [organizationProfileLoading, setOrganizationProfileLoading] = useState(false);
  const [personalProfileLoading, setPersonalProfileLoading] = useState(false);
  const autoLoadedOrganizationProfileIdRef = useRef<string | null>(null);
  const autoLoadedPersonalProfileRef = useRef(false);

  useEffect(() => {
    setOrganizationProfile(null);
    setOrganizationProfileLoading(false);
    autoLoadedOrganizationProfileIdRef.current = null;
  }, [selectedOrganizationId]);

  useEffect(() => {
    if (
      initialOrganizationId === null
      || selectedOrganizationId === null
      || organizationProfile !== null
      || autoLoadedOrganizationProfileIdRef.current === selectedOrganizationId
    ) {
      return;
    }

    let cancelled = false;
    autoLoadedOrganizationProfileIdRef.current = selectedOrganizationId;
    setOrganizationProfileLoading(true);
    void ensureOrganizationProfile({ organizationId: selectedOrganizationId })
      .then((nextProfile) => {
        if (!cancelled) {
          setOrganizationProfile(nextProfile);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          autoLoadedOrganizationProfileIdRef.current = null;
          setFeedback(error instanceof Error ? error.message : "Could not load shared sandbox auth.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setOrganizationProfileLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [initialOrganizationId, organizationProfile, selectedOrganizationId]);

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
    organizationProfile,
    setOrganizationProfile,
    personalProfile,
    setPersonalProfile,
    organizationProfileLoading,
    personalProfileLoading,
  };
}
