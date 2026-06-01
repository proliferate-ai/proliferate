import { useCallback, useEffect, useState } from "react";

import {
  getMobileStorageItem,
  setMobileStorageItem,
} from "../../../lib/access/mobile-storage";

const ONBOARDING_FLAG_KEY = "proliferate.mobile.onboarded.v1";

export type MobileOnboardingStatus = "checking" | "needed" | "done";

export function useMobileOnboardingStatus(authState: string): {
  completeOnboarding: () => Promise<void>;
  onboardingStatus: MobileOnboardingStatus;
} {
  const [onboardingStatus, setOnboardingStatus] = useState<MobileOnboardingStatus>("checking");

  useEffect(() => {
    if (authState !== "active") {
      setOnboardingStatus("checking");
      return;
    }
    let cancelled = false;
    void getMobileStorageItem(ONBOARDING_FLAG_KEY)
      .then((value) => {
        if (cancelled) {
          return;
        }
        setOnboardingStatus(value === "true" ? "done" : "needed");
      })
      .catch(() => {
        if (!cancelled) {
          setOnboardingStatus("needed");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authState]);

  const completeOnboarding = useCallback(async () => {
    try {
      await setMobileStorageItem(ONBOARDING_FLAG_KEY, "true");
    } catch {
      // best effort
    }
    setOnboardingStatus("done");
  }, []);

  return { completeOnboarding, onboardingStatus };
}
