import { useEffect, useRef } from "react";
import {
  useAgentGatewayCapabilities,
  useAuthSelections,
  usePutAuthSelections,
} from "@proliferate/cloud-sdk-react";
import { useAgentCatalog } from "#product/hooks/agents/derived/use-agent-catalog";
import { useCloudAvailabilityState } from "#product/hooks/cloud/derived/use-cloud-availability-state";
import { useProductHost } from "#product/host/ProductHostProvider";
import {
  runFirstRunAuthAdoption,
  settleFirstRunAuthAdoptionFailure,
} from "#product/lib/workflows/agents/first-run-auth-adoption";
import { useAuthSetupOnboardingStore } from "#product/stores/agents/auth-setup-onboarding-store";
import { recordRendererDiagnostic } from "#product/lib/infra/diagnostics/renderer-diagnostics-port";
import { useHarnessConnectionStore } from "#product/stores/sessions/harness-connection-store";

/**
 * First-run adoption of the managed gateway into auth selections (spec §9).
 * Runs once per app run, and only when the user has zero selections, so a
 * fresh profile falls back to the gateway for each gateway-capable harness
 * that detected no native credentials — independently per harness, so a
 * profile with SOME native credentials still falls back for the rest.
 * Harnesses with detected native creds are left on the implicit native state.
 *
 * Fire-and-forget: adoption failures are logged and never surfaced — the
 * settings page stays the authoritative place to manage auth.
 */
export function useFirstRunAuthAdoption() {
  const { authStatus, controlPlaneReachable } = useCloudAvailabilityState();
  const isDesktop = useProductHost().desktop !== null;
  const connectionState = useHarnessConnectionStore((state) => state.connectionState);
  // Control-plane gate, NOT a cloud-compute gate. Adoption writes auth
  // selections through the control plane; it has nothing to do with cloud
  // COMPUTE (E2B sandboxes). The previous `cloudActive = cloudComputeEnabled &&
  // authenticated` coupling meant a deployment with cloud compute off never ran
  // first-run adoption at all, so a fresh profile that detected no native
  // credentials kept zero selections and every gateway harness reported "no
  // launchable model". Same decoupling as `shouldSyncLocalAuthState`
  // (lib/domain/agents/local-auth-state.ts) and the settings `authGate`
  // (components/settings/screen/render-settings-section.tsx, ADR FM6/Q9).
  const authReady = authStatus === "authenticated" && controlPlaneReachable;
  const workflowQueriesEnabled = authReady && isDesktop;
  const capabilitiesQuery = useAgentGatewayCapabilities(workflowQueriesEnabled);
  const selectionsQuery = useAuthSelections(null, workflowQueriesEnabled);
  const {
    refetch: refetchAgents,
    reconcileSnapshot,
    reconcileStatus,
    reconcileIsError,
    reconcileError,
  } = useAgentCatalog();
  const putSelections = usePutAuthSelections();
  const recordAdoption = useAuthSetupOnboardingStore(
    (store) => store.recordAdoption,
  );
  const attemptedRef = useRef(false);

  const putMutate = putSelections.mutate;

  useEffect(() => {
    if (attemptedRef.current || !authReady) {
      return;
    }

    // Local auth adoption does not apply on Web. Settle without using any
    // local-runtime result so downstream readiness can distinguish no-op from
    // a still-pending Desktop decision.
    if (!isDesktop) {
      attemptedRef.current = true;
      recordAdoption([], Date.now());
      return;
    }

    const settleFailure = (
      stage: Parameters<typeof settleFirstRunAuthAdoptionFailure>[0]["stage"],
      error?: unknown,
    ) => {
      attemptedRef.current = true;
      settleFirstRunAuthAdoptionFailure(
        { stage, ...(error === undefined ? {} : { error }) },
        {
          now: Date.now,
          recordAdoption,
          recordDiagnostic: recordRendererDiagnostic,
        },
      );
    };

    if (connectionState === "failed") {
      settleFailure("runtime_connection");
      return;
    }
    if (connectionState === "connecting") {
      return;
    }

    const selections = selectionsQuery.data;
    const gatewayEnabled = capabilitiesQuery.data?.gatewayEnabled;

    // With a healthy runtime, arbitrate every already-known peer terminal
    // before returning for an earlier pending prerequisite. Precedence is
    // selections, capabilities, reconcile query, then reconcile job.
    if (selections === undefined && selectionsQuery.isError) {
      settleFailure("selections_query", selectionsQuery.error);
      return;
    }
    if (gatewayEnabled === undefined && capabilitiesQuery.isError) {
      settleFailure("capabilities_query", capabilitiesQuery.error);
      return;
    }
    if (reconcileIsError) {
      settleFailure("reconcile_query", reconcileError);
      return;
    }
    if (reconcileStatus === "failed") {
      settleFailure("reconcile_job");
      return;
    }

    // Once every known terminal has had a chance to settle the one shot, any
    // still-pending prerequisite blocks only the successful adoption path.
    if (
      selections === undefined
      || gatewayEnabled === undefined
      || reconcileSnapshot === null
    ) {
      return;
    }
    // `idle` is the startup service's pre-admission state, not a settled scan.
    // queued/running are likewise pending. Only completed authorizes the fresh
    // post-reconcile read and one-shot adoption workflow.
    if (reconcileStatus !== "completed") {
      return;
    }

    attemptedRef.current = true;
    void runFirstRunAuthAdoption(
      {
        selectionCount: selections.length,
        gatewayEnabled,
      },
      {
        now: Date.now,
        recordAdoption,
        recordDiagnostic: recordRendererDiagnostic,
        readFreshAgents: async () => {
          const result = await refetchAgents({ cancelRefetch: false });
          return result.isError
            ? { kind: "failure", error: result.error }
            : { kind: "success", agents: result.data ?? [] };
        },
        // Lazy: the planner stays out of the login first-load chunk and is
        // loaded only after authenticated Desktop reconciliation completes.
        loadPlanner: async () => {
          const { planFirstRunAuthAdoption } = await import(
            "#product/lib/domain/agents/auth-onboarding"
          );
          return planFirstRunAuthAdoption;
        },
        writeSelection: (action, onError) => {
          putMutate(
            {
              harnessKind: action.harnessKind,
              surface: action.surface,
              body: { sources: [{ sourceKind: "gateway", enabled: true }] },
            },
            { onError },
          );
        },
      },
    );
  }, [
    capabilitiesQuery.data,
    capabilitiesQuery.error,
    capabilitiesQuery.isError,
    authReady,
    connectionState,
    isDesktop,
    reconcileError,
    reconcileIsError,
    reconcileSnapshot,
    reconcileStatus,
    recordAdoption,
    refetchAgents,
    selectionsQuery.data,
    selectionsQuery.error,
    selectionsQuery.isError,
    putMutate,
  ]);
}
