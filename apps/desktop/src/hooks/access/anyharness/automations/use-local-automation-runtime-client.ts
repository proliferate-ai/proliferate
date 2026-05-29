import { useCallback } from "react";
import { createLocalAutomationRuntimeClient } from "@/lib/access/anyharness/automation-client";

export function useLocalAutomationRuntimeClientFactory() {
  return useCallback((args: { runtimeUrl: string }) =>
    createLocalAutomationRuntimeClient(args), []);
}
