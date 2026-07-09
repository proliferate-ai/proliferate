import { useEffect, useRef, useState } from "react";
import type { AgentAuthSurface } from "@proliferate/cloud-sdk";
import {
  useAgentApiKeys,
  useAgentGatewayCapabilities,
  useAgentGatewayEnrollment,
  useAuthSelections,
  useOrgAgentPolicy,
  usePutAuthSelections,
} from "@proliferate/cloud-sdk-react";
import { getHarnessEnvVarSuggestions } from "@/config/harness-env-vars";
import { useAgentCatalog } from "@/hooks/agents/derived/use-agent-catalog";
import { useAgentLoginTerminalWorkflow } from "@/hooks/agents/workflows/use-agent-login-terminal-workflow";
import { useActiveOrganization } from "@/hooks/organizations/facade/use-active-organization";
import { useCloudAvailabilityState } from "@/hooks/cloud/derived/use-cloud-availability-state";
import { isReadyAgent } from "@/lib/domain/agents/status";
import {
  buildDesiredSources,
  deriveEditorState,
  isMultiSourceHarness,
  isNativeState,
  type AuthMethod,
  type EditableApiKeyRow,
  type HarnessAuthEditorState,
} from "@/lib/domain/settings/harness-auth-sources";
import { useToastStore } from "@/stores/toast/toast-store";
import { HARNESS_PANE_COPY } from "@/copy/settings/harness-pane";

export interface HarnessAuthEditorApi {
  // Queries
  cloudActive: boolean;
  capabilitiesQuery: ReturnType<typeof useAgentGatewayCapabilities>;
  enrollmentQuery: ReturnType<typeof useAgentGatewayEnrollment>;
  selectionsQuery: ReturnType<typeof useAuthSelections>;
  apiKeysQuery: ReturnType<typeof useAgentApiKeys>;

  // Derived
  gatewayLocked: boolean;
  // Org-policy disabling (client-side hint; the server is the hard gate). null
  // allow-lists mean "no restriction" on that org, so every field below stays
  // false until an org's policy actively narrows it. A member may belong to
  // several orgs; the strictest applicable org wins (mirrors the server's
  // per-membership enforcement loop).
  //
  // harnessDisallowed only gates NEW enabled selections (gateway/api_key); it
  // never blocks going native, so a member can always clear a pre-existing
  // selection on a harness the org has since disallowed (there is no DELETE
  // endpoint — an empty/all-disabled PUT is the only remediation).
  harnessDisallowed: boolean;
  gatewayDisallowed: boolean;
  apiKeyDisallowed: boolean;
  nativeDisallowed: boolean;
  multiSource: boolean;
  busy: boolean;
  editorState: HarnessAuthEditorState;
  native: boolean;
  // Single-source radio: the method the user last clicked that has no wired
  // source yet (e.g. "api_key" before a key is chosen, or "cli"). Cleared once a
  // real source becomes enabled and reset per (harness, surface) scope.
  pendingMethod: AuthMethod | null;
  setPendingMethod: (method: AuthMethod | null) => void;
  localAgent: ReturnType<ReturnType<typeof useAgentCatalog>["agentsByKind"]["get"]>;
  loginSession: ReturnType<
    typeof useAgentLoginTerminalWorkflow
  >["sessionsByKind"][string] | undefined;
  loginWorkflow: ReturnType<typeof useAgentLoginTerminalWorkflow>;

  // Add-key modal state: the "Add API key" button and method-card clicks open
  // the modal instead of seeding an inline draft row.
  addKeyModalOpen: boolean;
  setAddKeyModalOpen: (open: boolean) => void;

  // Handlers
  commit: (next: HarnessAuthEditorState) => void;
  handleGatewayToggle: (next: boolean) => void;
  handleRowEnabledToggle: (uid: string, next: boolean) => void;
  handleRowKeySelect: (uid: string, keyId: string) => void;
  handleRowEnvVarChange: (uid: string, envVarName: string) => void;
  handleRowEnvVarBlur: () => void;
  handleRemoveRow: (uid: string) => void;
  addRow: (envVarName: string, providerHint: string | null) => void;
  addBoundApiKey: (envVarName: string, providerHint: string | null, apiKeyId: string) => void;
  handleAddVariable: () => void;
}

export function useHarnessAuthEditor(
  harnessKind: string,
  displayName: string,
  surface: AgentAuthSurface,
): HarnessAuthEditorApi {
  const { cloudActive } = useCloudAvailabilityState();
  const showToast = useToastStore((state) => state.show);

  // Org policy is the server's hard gate; here it also drives client-side
  // disabling so members see WHY an option is unavailable. The policy read is
  // org-admin-gated, so for plain members it simply errors and yields no hints
  // (the server still rejects a disallowed PUT, surfaced via the commit toast).
  const { activeOrganizationId } = useActiveOrganization();
  const orgPolicyQuery = useOrgAgentPolicy(
    activeOrganizationId,
    cloudActive && activeOrganizationId !== null,
  );

  const capabilitiesQuery = useAgentGatewayCapabilities(cloudActive);
  const enrollmentQuery = useAgentGatewayEnrollment(cloudActive);
  const selectionsQuery = useAuthSelections(null, cloudActive);
  const apiKeysQuery = useAgentApiKeys(cloudActive);
  const putSelections = usePutAuthSelections();
  const { agentsByKind } = useAgentCatalog();
  const loginWorkflow = useAgentLoginTerminalWorkflow();

  // Local-authoritative editor: seeded once per (harness, surface) scope, then
  // every edit PUTs the full desired source list (contract §5). We never reseed
  // from a later refetch of the same scope, so a PUT never clobbers the draft.
  const [gatewayEnabled, setGatewayEnabled] = useState(false);
  const [rows, setRows] = useState<EditableApiKeyRow[]>([]);
  const [pendingMethod, setPendingMethod] = useState<AuthMethod | null>(null);
  const [addKeyModalOpen, setAddKeyModalOpen] = useState(false);
  const seededScopeRef = useRef<string | null>(null);
  const lastPutSigRef = useRef<string>("");
  const draftCounterRef = useRef(0);

  const scopeKey = `${harnessKind}:${surface}`;
  const selections = selectionsQuery.data;

  useEffect(() => {
    if (selections === undefined || seededScopeRef.current === scopeKey) {
      return;
    }
    seededScopeRef.current = scopeKey;
    const derived = deriveEditorState(selections, harnessKind, surface);
    setGatewayEnabled(derived.gatewayEnabled);
    setRows(derived.rows);
    // A fresh scope starts with no pending selection — the derived state alone
    // drives the radio until the user clicks a method.
    setPendingMethod(null);
    lastPutSigRef.current = JSON.stringify(buildDesiredSources(derived));
  }, [selections, scopeKey, harnessKind, surface]);

  const localAgent = agentsByKind.get(harnessKind);
  const loginSession = loginWorkflow.sessionsByKind[harnessKind];

  // Close the auth terminal once the login round-trip made the agent ready.
  useEffect(() => {
    if (!loginSession?.terminal || !localAgent || !isReadyAgent(localAgent)) {
      return;
    }
    showToast(HARNESS_PANE_COPY.readyToast(displayName));
    void loginWorkflow.closeAuthTerminal(harnessKind);
  }, [
    displayName,
    harnessKind,
    localAgent,
    loginSession,
    loginWorkflow.closeAuthTerminal,
    showToast,
  ]);

  // Undefined capabilities means "not yet known" (still loading or errored), not
  // "gateway enabled" — treat it as disabled so a user can never persist a
  // gateway source on a gateway-disabled account before capabilities resolve. A
  // known-unsynced enrollment locks the gateway the same way.
  const capabilities = capabilitiesQuery.data;
  const enrollment = enrollmentQuery.data;
  const gatewayLocked =
    !capabilities?.gatewayEnabled
    || (enrollment !== undefined && enrollment.syncStatus !== "synced");
  const multiSource = isMultiSourceHarness(harnessKind);
  const busy = putSelections.isPending;
  const editorState: HarnessAuthEditorState = { gatewayEnabled, rows };
  const native = isNativeState(editorState);

  // Policy-driven disabling. null lists == no restriction; a route/harness
  // absent from a non-null list is disallowed by the org. Native is checked
  // against allowedRoutes only — never gated by harnessDisallowed — so going
  // native always stays reachable as the remediation path (mirrors the
  // server's _selection_set_policy_violation ordering).
  const allowedRoutes = orgPolicyQuery.data?.allowedRoutes ?? null;
  const allowedHarnesses = orgPolicyQuery.data?.allowedHarnesses ?? null;
  const harnessDisallowed =
    allowedHarnesses !== null && !allowedHarnesses.includes(harnessKind);
  const gatewayDisallowed =
    harnessDisallowed || (allowedRoutes !== null && !allowedRoutes.includes("gateway"));
  const apiKeyDisallowed =
    harnessDisallowed || (allowedRoutes !== null && !allowedRoutes.includes("api_key"));
  const nativeDisallowed = allowedRoutes !== null && !allowedRoutes.includes("native");

  function commit(next: HarnessAuthEditorState) {
    setGatewayEnabled(next.gatewayEnabled);
    setRows(next.rows);
    const sources = buildDesiredSources(next);
    const signature = JSON.stringify(sources);
    // De-dupe redundant PUTs (e.g. blur with no effective change).
    if (signature === lastPutSigRef.current) {
      return;
    }
    lastPutSigRef.current = signature;
    putSelections.mutate(
      { harnessKind, surface, body: { sources } },
      {
        onError: (error: { message?: string }) => {
          showToast(
            error.message || HARNESS_PANE_COPY.selectionUpdateError(displayName),
          );
        },
      },
    );
  }

  function handleGatewayToggle(next: boolean) {
    // Single-source harnesses hold at most one enabled source: turning the
    // gateway on turns every api-key row off (radio semantics via switches).
    const nextRows =
      next && !multiSource ? rows.map((row) => ({ ...row, enabled: false })) : rows;
    commit({ gatewayEnabled: next, rows: nextRows });
  }

  function handleRowEnabledToggle(uid: string, next: boolean) {
    const nextRows = rows.map((row) => {
      if (row.uid === uid) {
        return { ...row, enabled: next };
      }
      return next && !multiSource ? { ...row, enabled: false } : row;
    });
    const nextGateway = next && !multiSource ? false : gatewayEnabled;
    commit({ gatewayEnabled: nextGateway, rows: nextRows });
  }

  function handleRowKeySelect(uid: string, keyId: string) {
    commit({
      gatewayEnabled,
      rows: rows.map((row) => (row.uid === uid ? { ...row, apiKeyId: keyId } : row)),
    });
  }

  function handleRowEnvVarChange(uid: string, envVarName: string) {
    // Free-form editing stays local; the PUT lands on blur (or another action).
    setRows((current) =>
      current.map((row) => (row.uid === uid ? { ...row, envVarName } : row)),
    );
  }

  function handleRowEnvVarBlur() {
    commit(editorState);
  }

  function handleRemoveRow(uid: string) {
    commit({ gatewayEnabled, rows: rows.filter((row) => row.uid !== uid) });
  }

  function addRow(envVarName: string, providerHint: string | null) {
    draftCounterRef.current += 1;
    const newRow: EditableApiKeyRow = {
      uid: `draft-${draftCounterRef.current}`,
      envVarName,
      apiKeyId: null,
      providerHint,
      enabled: false,
    };
    // New rows are incomplete (no key yet) so nothing is PUT until wired.
    setRows((current) => [...current, newRow]);
  }

  function addBoundApiKey(envVarName: string, providerHint: string | null, apiKeyId: string) {
    draftCounterRef.current += 1;
    const newRow: EditableApiKeyRow = {
      uid: `draft-${draftCounterRef.current}`,
      envVarName,
      apiKeyId,
      providerHint,
      enabled: true,
    };
    // Single-source: enabling a new bound row disables everything else.
    const nextRows = multiSource
      ? [...rows, newRow]
      : [...rows.map((row) => ({ ...row, enabled: false })), newRow];
    const nextGateway = multiSource ? gatewayEnabled : false;
    commit({ gatewayEnabled: nextGateway, rows: nextRows });
  }

  function handleAddVariable() {
    const used = new Set(rows.map((row) => row.envVarName));
    const suggestion = getHarnessEnvVarSuggestions(harnessKind).find(
      (candidate) => !used.has(candidate.envVarName),
    );
    addRow(suggestion?.envVarName ?? "", suggestion?.providerHint ?? null);
  }

  return {
    cloudActive,
    capabilitiesQuery,
    enrollmentQuery,
    selectionsQuery,
    apiKeysQuery,
    gatewayLocked,
    harnessDisallowed,
    gatewayDisallowed,
    apiKeyDisallowed,
    nativeDisallowed,
    multiSource,
    busy,
    editorState,
    native,
    pendingMethod,
    setPendingMethod,
    localAgent,
    loginSession,
    loginWorkflow,
    addKeyModalOpen,
    setAddKeyModalOpen,
    commit,
    handleGatewayToggle,
    handleRowEnabledToggle,
    handleRowKeySelect,
    handleRowEnvVarChange,
    handleRowEnvVarBlur,
    handleRemoveRow,
    addRow,
    addBoundApiKey,
    handleAddVariable,
  };
}
