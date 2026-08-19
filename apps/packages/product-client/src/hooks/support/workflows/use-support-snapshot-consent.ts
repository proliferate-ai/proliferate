import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DesktopSupportSnapshotBridge,
} from "@proliferate/product-client/host/desktop-bridge";
import { useSupportSnapshotBinding } from "#product/hooks/support/derived/use-support-snapshot-binding";
import {
  collectResolvedSupportSessionEvidence,
  resolveSupportSnapshotAccess,
} from "#product/lib/access/anyharness/support-snapshot-connection";
import type { SupportReportSnapshotIntent } from "#product/lib/domain/support/report-types";
import {
  supportSnapshotConsent,
  supportSnapshotSelection,
  type SupportSnapshotScopeChoice,
} from "#product/lib/domain/support/support-snapshot-consent";
import {
  saveSupportSnapshotCopy,
  type SupportSnapshotSaveCopyWorkflowResult,
} from "#product/lib/workflows/support/save-support-snapshot-copy";

const PREPARATION_FAILED_MESSAGE =
  "Couldn't prepare the diagnostic snapshot. Try again, or clear the box to "
  + "send this report without it.";
const SAVE_FAILED_MESSAGE = "Couldn't save a copy of the diagnostic snapshot.";

export type SupportSnapshotPreparationResult =
  | { state: "none" }
  | {
      state: "prepared";
      /** The epoch the artifact was staged under; nothing else may spend it. */
      consentEpoch: string;
      intent: Extract<SupportReportSnapshotIntent, { kind: "prepared" }>;
    }
  | { state: "failed" }
  | { state: "cancelled" }
  | { state: "blocked"; reason: "busy" | "cleanup_unconfirmed" };

export type SupportSnapshotSaveCopyResult =
  | {
      state: "not_started";
      reason: "unavailable_or_not_consented" | "busy" | "cleanup_unconfirmed";
    }
  | { state: "preparation_failed" }
  | { state: "preparation_cancelled" }
  | SupportSnapshotSaveCopyWorkflowResult;

export interface SupportSnapshotConsentState {
  /** False on every host without the native coordinator; nothing renders. */
  available: boolean;
  consent: boolean;
  setConsent: (next: boolean) => void;
  scope: SupportSnapshotScopeChoice;
  setScope: (next: SupportSnapshotScopeChoice) => void;
  activeSessionAvailable: boolean;
  /** Preparation only; false while an already-prepared Save archives or cleans up. */
  isPreparing: boolean;
  /** True for an admitted Send preparation and the full Save action. */
  isBusy: boolean;
  /** Same-modal/client-job latch after artifact cleanup is unconfirmed. */
  snapshotActionsBlocked: boolean;
  error: string | null;
  /** Explicit Send: prepares only while consent is still true. */
  prepare: () => Promise<SupportSnapshotPreparationResult>;
  /** Explicit **Save a copy…**: prepares, archives, then settles exact cleanup. */
  saveCopy: () => Promise<SupportSnapshotSaveCopyResult>;
  /** Supersedes the epoch and cancels in-flight preparation. */
  cancel: () => void;
}

interface UseSupportSnapshotConsentOptions {
  clientJobId: string;
  reportOpenedAt: string;
}

interface SnapshotActionToken {
  readonly kind: "prepare" | "save_copy";
}

interface InFlightPreparation {
  bridge: DesktopSupportSnapshotBridge;
  clientJobId: string;
  consentEpoch: string;
  preparationId: string;
  controller: AbortController;
  cancellationPromise: Promise<void> | null;
}

/** Owns React admission, epoch, UI state, and stale-write policy for one report. */
export function useSupportSnapshotConsent(
  options: UseSupportSnapshotConsentOptions,
): SupportSnapshotConsentState {
  const binding = useSupportSnapshotBinding();
  const { bridge, bindingKey, defaultScope } = binding;
  const [consent, setConsentState] = useState(false);
  const [scope, setScopeState] = useState<SupportSnapshotScopeChoice>(defaultScope);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [snapshotActionsBlocked, setSnapshotActionsBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const bridgeRef = useRef(bridge);
  const bindingRef = useRef(binding);
  const consentRef = useRef(false);
  const scopeRef = useRef(scope);
  const epochRef = useRef(crypto.randomUUID());
  const grantedAtRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const actionRef = useRef<SnapshotActionToken | null>(null);
  const activeSavePromiseRef = useRef<Promise<SupportSnapshotSaveCopyResult> | null>(null);
  const snapshotActionsBlockedRef = useRef(false);
  const inFlightRef = useRef<InFlightPreparation | null>(null);
  bridgeRef.current = bridge;
  bindingRef.current = binding;

  const setBlocked = useCallback(() => {
    if (!mountedRef.current) return;
    snapshotActionsBlockedRef.current = true;
    setSnapshotActionsBlocked(true);
  }, []);

  const acquireAction = useCallback((kind: SnapshotActionToken["kind"]) => {
    if (busyRef.current) return null;
    const token: SnapshotActionToken = { kind };
    actionRef.current = token;
    busyRef.current = true;
    if (mountedRef.current) setIsBusy(true);
    return token;
  }, []);

  const releaseAction = useCallback((token: SnapshotActionToken) => {
    if (actionRef.current !== token) return;
    actionRef.current = null;
    busyRef.current = false;
    if (mountedRef.current) setIsBusy(false);
  }, []);

  const supersede = useCallback(() => {
    epochRef.current = crypto.randomUUID();
    const admitted = inFlightRef.current;
    if (!admitted) return;
    admitted.controller.abort();
    void settleCancellation(admitted);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      supersede();
    };
  }, [supersede]);

  const bindingKeyRef = useRef(bindingKey);
  useEffect(() => {
    if (bindingKeyRef.current === bindingKey) return;
    bindingKeyRef.current = bindingKey;
    supersede();
    consentRef.current = false;
    grantedAtRef.current = null;
    setConsentState(false);
    setError(null);
  }, [bindingKey, supersede]);

  const setConsent = useCallback((next: boolean) => {
    supersede();
    consentRef.current = next;
    grantedAtRef.current = next ? new Date().toISOString() : null;
    setError(null);
    setConsentState(next);
    if (next) {
      const nextScope = bindingRef.current.defaultScope;
      scopeRef.current = nextScope;
      setScopeState(nextScope);
    }
  }, [supersede]);

  const setScope = useCallback((next: SupportSnapshotScopeChoice) => {
    if (scopeRef.current === next) return;
    scopeRef.current = next;
    supersede();
    setError(null);
    grantedAtRef.current = new Date().toISOString();
    setScopeState(next);
  }, [supersede]);

  const runPreparation = useCallback(async (
    token: SnapshotActionToken,
    activeBridge: DesktopSupportSnapshotBridge,
  ): Promise<SupportSnapshotPreparationResult> => {
    const epoch = epochRef.current;
    const controller = new AbortController();
    let admitted: InFlightPreparation | null = null;
    const epochIsCurrent = () =>
      epochRef.current === epoch && !controller.signal.aborted;
    const uiIsCurrent = () =>
      mountedRef.current && actionRef.current === token && epochIsCurrent();
    const cancelAdmitted = async (): Promise<SupportSnapshotPreparationResult> => {
      if (admitted) {
        await settleCancellation(admitted);
        setBlocked();
      }
      return { state: "cancelled" };
    };

    if (mountedRef.current && actionRef.current === token) {
      setError(null);
      setIsPreparing(true);
    }
    try {
      const liveBinding = bindingRef.current;
      const access = await resolveSupportSnapshotAccess(
        liveBinding.accessInput(scopeRef.current),
      );
      if (!epochIsCurrent()) return await cancelAdmitted();
      const selection = supportSnapshotSelection(access);
      if (!selection) {
        if (uiIsCurrent()) setError(PREPARATION_FAILED_MESSAGE);
        return { state: "failed" };
      }
      const grantedConsent = supportSnapshotConsent({
        grantedAt: grantedAtRef.current ?? new Date().toISOString(),
        selection,
      });
      const preparation = await activeBridge.beginPreparation({
        clientJobId: options.clientJobId,
        reportOpenedAt: options.reportOpenedAt,
        consentEpoch: epoch,
        consent: grantedConsent,
      });
      admitted = {
        bridge: activeBridge,
        clientJobId: options.clientJobId,
        consentEpoch: epoch,
        preparationId: preparation.preparationId,
        controller,
        cancellationPromise: null,
      };
      inFlightRef.current = admitted;
      if (!epochIsCurrent()) return await cancelAdmitted();

      const evidence = await collectResolvedSupportSessionEvidence({
        preparation,
        access,
        cancellationSignal: controller.signal,
        isSelectionCurrent: epochIsCurrent,
      });
      if (evidence.state === "cancelled" || !epochIsCurrent()) {
        return await cancelAdmitted();
      }
      const artifact = await activeBridge.finishPreparation({
        preparationId: preparation.preparationId,
        consentEpoch: epoch,
        sessionEvidenceJson: evidence.sessionEvidenceJson,
        sessionCollection: evidence.sessionCollection,
      });
      if (!epochIsCurrent()) return await cancelAdmitted();
      return {
        state: "prepared",
        consentEpoch: epoch,
        intent: { kind: "prepared", consent: grantedConsent, artifact },
      };
    } catch {
      if (!epochIsCurrent()) return await cancelAdmitted();
      if (uiIsCurrent()) setError(PREPARATION_FAILED_MESSAGE);
      return { state: "failed" };
    } finally {
      if (inFlightRef.current === admitted) inFlightRef.current = null;
      if (mountedRef.current && actionRef.current === token) setIsPreparing(false);
    }
  }, [options.clientJobId, options.reportOpenedAt, setBlocked]);

  const prepare = useCallback(async (): Promise<SupportSnapshotPreparationResult> => {
    if (busyRef.current) return { state: "blocked", reason: "busy" };
    const activeBridge = bridgeRef.current;
    if (!activeBridge || !consentRef.current) return { state: "none" };
    if (snapshotActionsBlockedRef.current) {
      return { state: "blocked", reason: "cleanup_unconfirmed" };
    }
    const token = acquireAction("prepare");
    if (!token) return { state: "blocked", reason: "busy" };
    try {
      return await runPreparation(token, activeBridge);
    } finally {
      releaseAction(token);
    }
  }, [acquireAction, releaseAction, runPreparation]);

  const saveCopy = useCallback((): Promise<SupportSnapshotSaveCopyResult> => {
    const active = activeSavePromiseRef.current;
    if (active) return active;
    const activeBridge = bridgeRef.current;
    if (!activeBridge || !consentRef.current) {
      return Promise.resolve({
        state: "not_started",
        reason: "unavailable_or_not_consented",
      });
    }
    if (busyRef.current) {
      return Promise.resolve({ state: "not_started", reason: "busy" });
    }
    if (snapshotActionsBlockedRef.current) {
      return Promise.resolve({
        state: "not_started",
        reason: "cleanup_unconfirmed",
      });
    }
    const token = acquireAction("save_copy");
    if (!token) return Promise.resolve({ state: "not_started", reason: "busy" });

    const promise: Promise<SupportSnapshotSaveCopyResult> = (async (): Promise<SupportSnapshotSaveCopyResult> => {
      try {
        const prepared = await runPreparation(token, activeBridge);
        if (prepared.state === "failed") return { state: "preparation_failed" };
        if (prepared.state === "cancelled") return { state: "preparation_cancelled" };
        if (prepared.state !== "prepared") {
          return {
            state: "not_started",
            reason: prepared.state === "blocked"
              ? prepared.reason
              : "unavailable_or_not_consented",
          };
        }
        const artifactId = prepared.intent.artifact.artifactId;
        const result = await saveSupportSnapshotCopy(
          { artifactId, consentEpoch: prepared.consentEpoch },
          {
            saveArchive: (input) => activeBridge.saveArchive(input),
            deleteArtifact: (id) => activeBridge.deleteArtifact(id),
          },
        );
        if (
          result.state === "save_failed"
          && mountedRef.current
          && actionRef.current === token
          && epochRef.current === prepared.consentEpoch
        ) {
          setError(SAVE_FAILED_MESSAGE);
        }
        if (result.cleanup === "unconfirmed") setBlocked();
        return result;
      } finally {
        releaseAction(token);
      }
    })();
    activeSavePromiseRef.current = promise;
    void promise.finally(() => {
      if (activeSavePromiseRef.current === promise) {
        activeSavePromiseRef.current = null;
      }
    });
    return promise;
  }, [acquireAction, releaseAction, runPreparation, setBlocked]);

  return {
    available: bridge !== null,
    consent,
    setConsent,
    scope,
    setScope,
    activeSessionAvailable: binding.activeSessionAvailable,
    isPreparing,
    isBusy,
    snapshotActionsBlocked,
    error,
    prepare,
    saveCopy,
    cancel: supersede,
  };
}

function settleCancellation(record: InFlightPreparation): Promise<void> {
  if (!record.cancellationPromise) {
    record.cancellationPromise = record.bridge.cancelPreparation({
      clientJobId: record.clientJobId,
      consentEpoch: record.consentEpoch,
      preparationId: record.preparationId,
    }).catch(() => {});
  }
  return record.cancellationPromise;
}
