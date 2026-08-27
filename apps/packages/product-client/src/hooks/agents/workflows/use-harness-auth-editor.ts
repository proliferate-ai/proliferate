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
import { getHarnessEnvVarSuggestions } from "#product/config/harness-env-vars";
import { useAgentCatalog } from "#product/hooks/agents/derived/use-agent-catalog";
import { useAgentLoginTerminalWorkflow } from "#product/hooks/agents/workflows/use-agent-login-terminal-workflow";
import { useActiveOrganization } from "#product/hooks/organizations/facade/use-active-organization";
import { useCloudAvailabilityState } from "#product/hooks/cloud/derived/use-cloud-availability-state";
import { isReadyAgent } from "#product/lib/domain/agents/status";
import {
  buildDesiredSources,
  deriveEditorState,
  isMultiSourceHarness,
  isNativeState,
  type AuthMethod,
  type EditableApiKeyRow,
  type HarnessAuthEditorState,
} from "#product/lib/domain/settings/harness-auth-sources";
import { useToastStore } from "#product/stores/toast/toast-store";
import { HARNESS_PANE_COPY } from "#product/copy/settings/harness-pane";

// Poll cadence while a delivery ack is outstanding (pending → applied). Named exception (does not sit on the `cadence` scale): 3s falls strictly between `cadence.fastMs` (1s) and `cadence.standardMs` (5s), the harness auth pane's own delivery-ack watch kept in lockstep with the onboarding step's `AUTH_SETUP_POLL_MS`; snapping down to fast would tighten (forbidden), snapping up to standard would visibly stretch how long a pending → applied row sits in the editor the user has open (UX Latency + Transitions ADR §4.7, Rung 6, Q8).
const DELIVERY_PENDING_POLL_MS = 3000;

/**
 * Per-commit outcome hooks. A caller that must not report success before the
 * selection PUT lands (the provider picker: it created a vault key first and
 * has to revoke it if the PUT fails, or the key is orphaned) passes these; the
 * default path stays toast-on-error.
 */
export interface CommitCallbacks {
  onSuccess?: () => void;
  onError?: (message: string) => void;
}

export interface HarnessAuthEditorApi {
  // Queries
  // The auth plane is ready: the user is signed into the control plane and it
  // is reachable. Model-auth (BYOK/api_key + gateway route) is an auth-plane
  // capability, so it gates on this — NOT on cloud compute (E2B). A local-only
  // or self-hosted user with no cloud compute can still store keys / pick a
  // route. Mirrors PR 1's decoupling of local gateway-state sync from compute.
  authReady: boolean;
  capabilitiesQuery: ReturnType<typeof useAgentGatewayCapabilities>;
  enrollmentQuery: ReturnType<typeof useAgentGatewayEnrollment>;
  selectionsQuery: ReturnType<typeof useAuthSelections>;
  apiKeysQuery: ReturnType<typeof useAgentApiKeys>;

  // Applied means acknowledged (agent-auth.md): true while this (harness,
  // surface) scope has a selection delivery the surface's runtime has not yet
  // acknowledged. Drives the pane's "Applying…" indicator; while pending the
  // selections query polls so a server-side ack (the cloud materializer's)
  // flips the pane without any client mutation.
  deliveryPending: boolean;

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
  seatDisallowed: boolean;
  nativeDisallowed: boolean;
  multiSource: boolean;
  busy: boolean;
  editorState: HarnessAuthEditorState;
  native: boolean;
  // Seats v1: the vault holds at least one active seat (anthropic_subscription
  // entry). Gates the seat card's ability to COMMIT the pool selection — with
  // zero seats an enabled pool row would fail every launch closed.
  hasSeats: boolean;
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
  commit: (next: HarnessAuthEditorState, callbacks?: CommitCallbacks) => void;
  handleGatewayToggle: (next: boolean) => void;
  handleSeatToggle: (next: boolean, callbacks?: CommitCallbacks) => void;
  handleRowEnabledToggle: (uid: string, next: boolean) => void;
  handleRowKeySelect: (uid: string, keyId: string) => void;
  handleRowEnvVarChange: (uid: string, envVarName: string) => void;
  handleRowEnvVarBlur: () => void;
  handleRemoveRow: (uid: string) => void;
  addRow: (envVarName: string, providerHint: string | null) => void;
  addBoundApiKey: (
    envVarName: string,
    providerHint: string | null,
    apiKeyId: string,
    callbacks?: CommitCallbacks,
  ) => void;
  handleAddVariable: () => void;
}

export function useHarnessAuthEditor(
  harnessKind: string,
  displayName: string,
  surface: AgentAuthSurface,
): HarnessAuthEditorApi {
  const { authStatus, controlPlaneReachable } = useCloudAvailabilityState();
  // Auth-plane readiness: signed in + control plane reachable. Cloud compute is
  // deliberately NOT part of this — model-auth surfaces must work for a
  // local-only / self-hosted user who never provisioned E2B.
  const authReady = authStatus === "authenticated" && controlPlaneReachable;
  const showToast = useToastStore((state) => state.show);

  // Org policy is the server's hard gate; here it also drives client-side
  // disabling so members see WHY an option is unavailable. The policy read is
  // org-admin-gated, so for plain members it simply errors and yields no hints
  // (the server still rejects a disallowed PUT, surfaced via the commit toast).
  const { activeOrganizationId } = useActiveOrganization();
  const orgPolicyQuery = useOrgAgentPolicy(
    activeOrganizationId,
    authReady && activeOrganizationId !== null,
  );

  const capabilitiesQuery = useAgentGatewayCapabilities(authReady);
  const enrollmentQuery = useAgentGatewayEnrollment(authReady);
  // While a delivery is pending the acks land out-of-band (the desktop sync
  // hook's ack POST, or the cloud materializer server-side), so the query
  // polls until the scope reads applied again (state-driven: one render
  // behind `deliveryPending`, which is fine for a poll gate).
  const [deliveryPolling, setDeliveryPolling] = useState(false);
  const selectionsQuery = useAuthSelections(null, authReady, {
    refetchInterval: deliveryPolling ? DELIVERY_PENDING_POLL_MS : false,
  });
  const apiKeysQuery = useAgentApiKeys(authReady);
  const putSelections = usePutAuthSelections();
  const { agentsByKind } = useAgentCatalog();
  const loginWorkflow = useAgentLoginTerminalWorkflow(surface);

  // Local-authoritative editor: seeded once per (harness, surface) scope, then
  // every edit PUTs the full desired source list (contract §5). We never reseed
  // from a later refetch of the same scope, so a PUT never clobbers the draft.
  const [gatewayEnabled, setGatewayEnabled] = useState(false);
  const [seatEnabled, setSeatEnabled] = useState(false);
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
    setSeatEnabled(derived.seatEnabled);
    setRows(derived.rows);
    // A fresh scope starts with no pending selection — the derived state alone
    // drives the radio until the user clicks a method.
    setPendingMethod(null);
    lastPutSigRef.current = JSON.stringify(buildDesiredSources(harnessKind, derived));
  }, [selections, scopeKey, harnessKind, surface]);

  // Pending delivery for THIS scope only: a sibling harness's (or the other
  // surface's) unacked change must not flip this pane to "Applying…". Only an
  // EXPLICIT `applied: false` is pending — the field is schema-optional so
  // pre-ack fixtures/clients read as applied, never as falsely pending.
  const deliveryPending = (selections ?? []).some(
    (record) =>
      record.harnessKind === harnessKind
      && record.surface === surface
      && record.applied === false,
  );
  useEffect(() => {
    setDeliveryPolling(deliveryPending);
  }, [deliveryPending]);

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
  const editorState: HarnessAuthEditorState = { gatewayEnabled, seatEnabled, rows };
  const native = isNativeState(editorState);
  const hasSeats = (apiKeysQuery.data ?? []).some(
    (key) => key.kind === "anthropic_subscription" && key.status === "active",
  );

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
  const seatDisallowed =
    harnessDisallowed || (allowedRoutes !== null && !allowedRoutes.includes("seat"));
  const nativeDisallowed = allowedRoutes !== null && !allowedRoutes.includes("native");

  function commit(next: HarnessAuthEditorState, callbacks: CommitCallbacks = {}) {
    // Snapshot for rollback: the optimistic setState below would otherwise keep
    // rendering a rejected row as wired until a reload.
    const previous: HarnessAuthEditorState = { gatewayEnabled, seatEnabled, rows };
    const previousSig = lastPutSigRef.current;
    setGatewayEnabled(next.gatewayEnabled);
    setSeatEnabled(next.seatEnabled);
    setRows(next.rows);
    const sources = buildDesiredSources(harnessKind, next);
    const signature = JSON.stringify(sources);
    // De-dupe redundant PUTs (e.g. blur with no effective change). Nothing was
    // sent, so the desired state already holds — that's a success for callers
    // waiting on persistence.
    if (signature === previousSig) {
      callbacks.onSuccess?.();
      return;
    }
    lastPutSigRef.current = signature;
    putSelections.mutate(
      { harnessKind, surface, body: { sources } },
      {
        onSuccess: () => {
          callbacks.onSuccess?.();
        },
        onError: (error: { message?: string }) => {
          // Roll the optimistic state back so the UI never claims a rejected
          // selection is wired.
          setGatewayEnabled(previous.gatewayEnabled);
          setSeatEnabled(previous.seatEnabled);
          setRows(previous.rows);
          lastPutSigRef.current = previousSig;
          const message =
            error.message || HARNESS_PANE_COPY.selectionUpdateError(displayName);
          // A caller that renders its own error owns the surfacing; don't
          // double-report it as a toast too.
          if (callbacks.onError) {
            callbacks.onError(message);
            return;
          }
          showToast(message);
        },
      },
    );
  }

  function handleGatewayToggle(next: boolean) {
    // Single-source harnesses hold at most one enabled source: turning the
    // gateway on turns every api-key row (and the seat pool) off (radio
    // semantics via switches).
    const nextRows =
      next && !multiSource ? rows.map((row) => ({ ...row, enabled: false })) : rows;
    const nextSeat = next && !multiSource ? false : seatEnabled;
    commit({ gatewayEnabled: next, seatEnabled: nextSeat, rows: nextRows });
  }

  function handleSeatToggle(next: boolean, callbacks: CommitCallbacks = {}) {
    // Seats are radio-only (claude): enabling the pool turns everything else
    // off. The radio counts kinds, so the one pool row is the one method.
    const nextRows = next ? rows.map((row) => ({ ...row, enabled: false })) : rows;
    const nextGateway = next ? false : gatewayEnabled;
    commit(
      { gatewayEnabled: nextGateway, seatEnabled: next, rows: nextRows },
      callbacks,
    );
  }

  function handleRowEnabledToggle(uid: string, next: boolean) {
    const nextRows = rows.map((row) => {
      if (row.uid === uid) {
        return { ...row, enabled: next };
      }
      return next && !multiSource ? { ...row, enabled: false } : row;
    });
    const nextGateway = next && !multiSource ? false : gatewayEnabled;
    const nextSeat = next && !multiSource ? false : seatEnabled;
    commit({ gatewayEnabled: nextGateway, seatEnabled: nextSeat, rows: nextRows });
  }

  function handleRowKeySelect(uid: string, keyId: string) {
    commit({
      gatewayEnabled,
      seatEnabled,
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
    commit({ gatewayEnabled, seatEnabled, rows: rows.filter((row) => row.uid !== uid) });
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

  function addBoundApiKey(
    envVarName: string,
    providerHint: string | null,
    apiKeyId: string,
    callbacks: CommitCallbacks = {},
  ) {
    draftCounterRef.current += 1;
    const newRow: EditableApiKeyRow = {
      uid: `draft-${draftCounterRef.current}`,
      envVarName,
      apiKeyId,
      providerHint,
      enabled: true,
    };
    // Replacement semantics: at most one row per env var — the server keys a
    // selection scope by (source_kind, env_var_name) and rejects duplicates,
    // so binding a key to an already-bound var swaps the row in ONE commit
    // (one PUT) rather than a remove-then-add pair racing each other.
    const kept = rows.filter((row) => row.envVarName !== envVarName);
    // Single-source: enabling a new bound row disables everything else.
    const nextRows = multiSource
      ? [...kept, newRow]
      : [...kept.map((row) => ({ ...row, enabled: false })), newRow];
    const nextGateway = multiSource ? gatewayEnabled : false;
    const nextSeat = multiSource ? seatEnabled : false;
    commit({ gatewayEnabled: nextGateway, seatEnabled: nextSeat, rows: nextRows }, callbacks);
  }

  function handleAddVariable() {
    const used = new Set(rows.map((row) => row.envVarName));
    const suggestion = getHarnessEnvVarSuggestions(harnessKind).find(
      (candidate) => !used.has(candidate.envVarName),
    );
    addRow(suggestion?.envVarName ?? "", suggestion?.providerHint ?? null);
  }

  return {
    authReady,
    capabilitiesQuery,
    enrollmentQuery,
    selectionsQuery,
    apiKeysQuery,
    deliveryPending,
    gatewayLocked,
    harnessDisallowed,
    gatewayDisallowed,
    apiKeyDisallowed,
    seatDisallowed,
    nativeDisallowed,
    multiSource,
    busy,
    editorState,
    native,
    hasSeats,
    pendingMethod,
    setPendingMethod,
    localAgent,
    loginSession,
    loginWorkflow,
    addKeyModalOpen,
    setAddKeyModalOpen,
    commit,
    handleGatewayToggle,
    handleSeatToggle,
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
