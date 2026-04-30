import { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useModelRegistriesQuery } from "@anyharness/sdk-react";
import {
  CURRENT_ONBOARDING_VERSION,
} from "@/config/onboarding";
import { buildOnboardingFinalizerDefaultsUpdate } from "@/lib/domain/onboarding/defaults";
import { trackProductEvent } from "@/lib/integrations/telemetry/client";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

// Fills in missing chat defaults after onboarding completes but before
// registries loaded. Idempotent: only writes when
//   (a) the user has finished onboarding at CURRENT_ONBOARDING_VERSION AND
//   (b) one or both default chat fields are still missing or invalid.
// Never overwrites a complete explicit selection made on the recommendation
// step or later in Settings. If only one field is missing, we fill it with a
// value that matches the preserved agent selection.
export function useOnboardingFinalizer(): void {
  const { data: registries } = useModelRegistriesQuery();
  const preferences = useUserPreferencesStore(
    useShallow((state) => ({
      onboardingCompletedVersion: state.onboardingCompletedVersion,
      onboardingPrimaryGoalId: state.onboardingPrimaryGoalId,
      defaultChatAgentKind: state.defaultChatAgentKind,
      defaultChatModelIdByAgentKind: state.defaultChatModelIdByAgentKind,
      defaultSessionModeByAgentKind: state.defaultSessionModeByAgentKind,
      setMultiple: state.setMultiple,
    })),
  );
  const appliedRef = useRef(false);

  useEffect(() => {
    if (appliedRef.current) return;
    if (preferences.onboardingCompletedVersion < CURRENT_ONBOARDING_VERSION) return;
    if (!registries || registries.length === 0) return;

    const result = buildOnboardingFinalizerDefaultsUpdate({
      preferences,
      registries,
    });
    if (!result) return;

    appliedRef.current = true;
    preferences.setMultiple(result.update);

    if (result.finalizedAgentKind) {
      trackProductEvent("onboarding_defaults_finalized", {
        goal_id: preferences.onboardingPrimaryGoalId || null,
        recommended_agent_kind: result.finalizedAgentKind,
      });
    }
  }, [preferences, registries]);
}
