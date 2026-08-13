import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DesktopSupportSnapshotBridge,
} from "@proliferate/product-client/host/desktop-bridge";
import type { SupportReportSnapshotIntent } from "#product/lib/domain/support/report-types";
import {
  supportSnapshotConsent,
  supportSnapshotSelection,
  type SupportSnapshotScopeChoice,
} from "#product/lib/domain/support/support-snapshot-consent";
import {
  collectResolvedSupportSessionEvidence,
  resolveSupportSnapshotAccess,
} from "#product/lib/access/anyharness/support-snapshot-connection";
import { useSupportSnapshotBinding } from "#product/hooks/support/derived/use-support-snapshot-binding";

const PREPARATION_FAILED_MESSAGE =
  "Couldn't prepare the diagnostic snapshot. Try again, or clear the box to "
  + "send this report without it.";
const SAVE_FAILED_MESSAGE = "Couldn't save a copy of the diagnostic snapshot.";

export type SupportSnapshotPreparationResult =
  | { state: "none" }
  | { state: "prepared"; intent: Extract<SupportReportSnapshotIntent, { kind: "prepared" }> }
  | { state: "failed" }
  | { state: "cancelled" };

export interface SupportSnapshotConsentState {
  /** False on every host without the native coordinator; nothing renders. */
  available: boolean;
  consent: boolean;
  setConsent: (next: boolean) => void;
  scope: SupportSnapshotScopeChoice;
  setScope: (next: SupportSnapshotScopeChoice) => void;
  activeSessionAvailable: boolean;
  isPreparing: boolean;
  error: string | null;
  /** Explicit Send: prepares only while consent is still true. */
  prepare: () => Promise<SupportSnapshotPreparationResult>;
  /** Explicit **Save a copy…**: prepares, writes the ZIP, keeps the modal open. */
  saveCopy: () => Promise<void>;
  /** Supersedes the epoch and cancels in-flight preparation. */
  cancel: () => void;
}

interface UseSupportSnapshotConsentOptions {
  clientJobId: string;
  reportOpenedAt: string;
}

/**
 * The per-report snapshot consent epoch.
 *
 * Consent starts unchecked on every open and is never persisted or inherited.
 * Nothing native runs while the user reads the disclosure, checks the box, or
 * changes scope: only an explicit Send or **Save a copy…** while consent is
 * still true starts a preparation. A binding change, a scope change, clearing
 * the box, or cancelling supersedes the epoch, so a late result from a
 * superseded epoch can never reach the queue.
 */
export function useSupportSnapshotConsent(
  options: UseSupportSnapshotConsentOptions,
): SupportSnapshotConsentState {
  const binding = useSupportSnapshotBinding();
  const { bridge, bindingKey, defaultScope } = binding;
  const [consent, setConsentState] = useState(false);
  const [scope, setScopeState] = useState<SupportSnapshotScopeChoice>(defaultScope);
  const [isPreparing, setIsPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const epochRef = useRef(crypto.randomUUID());
  const grantedAtRef = useRef<string | null>(null);
  const scopeRef = useRef(scope);
  const inFlightRef = useRef<InFlightPreparation | null>(null);

  const supersede = useCallback(() => {
    const previous = inFlightRef.current;
    inFlightRef.current = null;
    epochRef.current = crypto.randomUUID();
    if (previous) {
      previous.controller.abort();
      void previous.cancel();
    }
  }, []);

  // A binding change supersedes the epoch even mid-preparation. Consent is
  // specific to one exact workspace/session binding, so it is cleared rather
  // than silently re-pointed at whatever the user just selected.
  const bindingKeyRef = useRef(bindingKey);
  useEffect(() => {
    if (bindingKeyRef.current === bindingKey) {
      return;
    }
    bindingKeyRef.current = bindingKey;
    supersede();
    grantedAtRef.current = null;
    setConsentState(false);
    setError(null);
  }, [bindingKey, supersede]);

  const setConsent = useCallback((next: boolean) => {
    supersede();
    setError(null);
    grantedAtRef.current = next ? new Date().toISOString() : null;
    setConsentState(next);
    if (next) {
      scopeRef.current = defaultScope;
      setScopeState(defaultScope);
    }
  }, [defaultScope, supersede]);

  const setScope = useCallback((next: SupportSnapshotScopeChoice) => {
    if (scopeRef.current === next) {
      return;
    }
    scopeRef.current = next;
    supersede();
    setError(null);
    grantedAtRef.current = new Date().toISOString();
    setScopeState(next);
  }, [supersede]);

  const prepare = useCallback(async (): Promise<SupportSnapshotPreparationResult> => {
    if (!bridge || !consent) {
      return { state: "none" };
    }
    const epoch = epochRef.current;
    const controller = new AbortController();
    const isCurrent = () => epochRef.current === epoch && !controller.signal.aborted;
    setError(null);
    setIsPreparing(true);
    try {
      const access = await resolveSupportSnapshotAccess(binding.accessInput(scope));
      if (!isCurrent()) {
        return { state: "cancelled" };
      }
      const selection = supportSnapshotSelection(access);
      if (!selection) {
        setError(PREPARATION_FAILED_MESSAGE);
        return { state: "failed" };
      }
      const grantedConsent = supportSnapshotConsent({
        grantedAt: grantedAtRef.current ?? new Date().toISOString(),
        selection,
      });
      const preparation = await bridge.beginPreparation({
        clientJobId: options.clientJobId,
        reportOpenedAt: options.reportOpenedAt,
        consentEpoch: epoch,
        consent: grantedConsent,
      });
      inFlightRef.current = {
        controller,
        cancel: () => cancelPreparation(bridge, options.clientJobId, epoch, preparation.preparationId),
      };
      if (!isCurrent()) {
        return { state: "cancelled" };
      }
      const evidence = await collectResolvedSupportSessionEvidence({
        preparation,
        access,
        cancellationSignal: controller.signal,
        isSelectionCurrent: isCurrent,
      });
      if (evidence.state === "cancelled" || !isCurrent()) {
        return { state: "cancelled" };
      }
      const artifact = await bridge.finishPreparation({
        preparationId: preparation.preparationId,
        consentEpoch: epoch,
        sessionEvidenceJson: evidence.sessionEvidenceJson,
        sessionCollection: evidence.sessionCollection,
      });
      inFlightRef.current = null;
      if (!isCurrent()) {
        void bridge.deleteArtifact(artifact.artifactId).catch(() => {});
        return { state: "cancelled" };
      }
      return {
        state: "prepared",
        intent: { kind: "prepared", consent: grantedConsent, artifact },
      };
    } catch {
      if (isCurrent()) {
        setError(PREPARATION_FAILED_MESSAGE);
        return { state: "failed" };
      }
      return { state: "cancelled" };
    } finally {
      if (inFlightRef.current?.controller === controller) {
        inFlightRef.current = null;
      }
      setIsPreparing(false);
    }
  }, [binding, bridge, consent, options.clientJobId, options.reportOpenedAt, scope]);

  const saveCopy = useCallback(async () => {
    const prepared = await prepare();
    if (prepared.state !== "prepared" || !bridge) {
      return;
    }
    const artifactId = prepared.intent.artifact.artifactId;
    try {
      await bridge.saveArchive({ artifactId, consentEpoch: epochRef.current });
    } catch {
      setError(SAVE_FAILED_MESSAGE);
    } finally {
      // The saved ZIP is the user's copy. The staged artifact backs no queued
      // job, so it is released instead of waiting for the next startup sweep.
      void bridge.deleteArtifact(artifactId).catch(() => {});
    }
  }, [bridge, prepare]);

  return {
    available: bridge !== null,
    consent,
    setConsent,
    scope,
    setScope,
    activeSessionAvailable: binding.activeSessionAvailable,
    isPreparing,
    error,
    prepare,
    saveCopy,
    cancel: supersede,
  };
}

interface InFlightPreparation {
  controller: AbortController;
  cancel: () => Promise<void>;
}

function cancelPreparation(
  bridge: DesktopSupportSnapshotBridge,
  clientJobId: string,
  consentEpoch: string,
  preparationId: string,
): Promise<void> {
  return bridge
    .cancelPreparation({ clientJobId, consentEpoch, preparationId })
    .catch(() => {});
}
