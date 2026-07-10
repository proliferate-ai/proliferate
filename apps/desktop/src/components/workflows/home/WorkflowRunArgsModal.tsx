import { useEffect, useMemo, useState } from "react";
import type { WorkflowInputSpec } from "@proliferate/product-domain/workflows/definition";
import type { WorkflowTargetMode } from "@proliferate/product-domain/workflows/model";
import {
  FRESH_SESSION_CHOICE,
  isBindableSessionCandidate,
  isExistingSessionChoice,
  type SlotSessionBinding,
} from "@proliferate/product-domain/workflows/run-launch";
import { cloudWorkspaceSyntheticId } from "@/lib/domain/workspaces/cloud/cloud-ids";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@proliferate/ui/primitives/Label";
import { ModalShell } from "@proliferate/ui/primitives/ModalShell";
import { Switch } from "@proliferate/ui/primitives/Switch";
import { CircleAlert } from "@proliferate/ui/icons";
import { ProviderIcon } from "@proliferate/ui/provider-icons";
import { WorkflowSelect } from "../editor/WorkflowSelect";

type TargetMode = WorkflowTargetMode;
type ArgValue = string | number | boolean;

/** A selectable run target (a local runtime workspace, or a cloud workspace). */
export interface WorkflowRunTargetOption {
  id: string;
  label: string;
}

/** One agent slot from the definition — the unit a session binds to (L29). */
export interface WorkflowRunSlotOption {
  slot: string;
  harness: string;
  model: string;
}

/** A live session the launcher may bind to a same-harness slot (R3 minority
 * path). Held sessions render disabled — another run owns them (E8). */
export interface WorkflowRunSessionCandidate {
  id: string;
  title: string;
  harness: string;
  /** The workspace the session lives on (same id space as the modal's own
   * `localWorkspaceId`/cloud-synthetic ids) — a candidate is only offered
   * for the slot's *currently selected* run target (B8/L29: "session
   * belongs to the target workspace"). */
  workspaceId?: string | null;
  /** e.g. "3m ago" — shown when the session is free. */
  lastActiveLabel?: string;
  /** Non-null → held by another run; not selectable. */
  heldByLabel?: string | null;
}

export interface WorkflowRunSubmit {
  args: Record<string, ArgValue>;
  targetMode: TargetMode;
  localWorkspaceId?: string;
  cloudWorkspaceId?: string;
  /** One entry per slot; fresh-by-default (`sessionId` = "new"). */
  sessionBindings: SlotSessionBinding[];
}

export interface WorkflowRunArgsModalProps {
  open: boolean;
  workflowName: string;
  args: readonly WorkflowInputSpec[];
  localWorkspaces: readonly WorkflowRunTargetOption[];
  cloudWorkspaces: readonly WorkflowRunTargetOption[];
  /** Agent slots (definition order). Drives the per-slot session-binding rows;
   * omit for the arg-only modal. */
  slots?: readonly WorkflowRunSlotOption[];
  /** Live sessions eligible to bind (any harness). Filtered to the slot's
   * harness per row; empty = fresh-only (the common case, R3). Chat-origin
   * launches should list the current session first. */
  sessionCandidates?: readonly WorkflowRunSessionCandidate[];
  /** Default local workspace (e.g. the currently-open one), if any. */
  defaultLocalWorkspaceId?: string | null;
  /** Last-used target for this workflow (R6). Pre-selects the run location and
   * cloud workspace when they still exist. */
  defaultTargetMode?: TargetMode | null;
  defaultCloudWorkspaceId?: string | null;
  /** Chat-origin launches (R1 door 1): the target is implicit — the
   * workspace the composer lives in — so no picker row is rendered (spec
   * run-from-chat). Non-null shows a quiet read-only line instead, using
   * this as the workspace label. `defaultTargetMode`/`defaultLocalWorkspaceId`/
   * `defaultCloudWorkspaceId` still carry the actual target values. */
  chatOriginLabel?: string | null;
  /** Whether this workflow declares a non-empty `integrations` grant (spec 5.3,
   * E3): drives the local-target warning below — cloud-only in v1, never a
   * block. */
  hasIntegrations?: boolean;
  busy?: boolean;
  error?: string | null;
  /** Shown as a link under `error` when the failure is the L22 no-ready-account
   * case (`workflow_function_provider_not_ready`) — the enumerated reason
   * already names the provider in `error`; this jumps to where to fix it. */
  onOpenIntegrationsSettings?: () => void;
  onClose: () => void;
  onSubmit: (input: WorkflowRunSubmit) => void;
}

function initialValue(arg: WorkflowInputSpec): ArgValue {
  if (arg.default !== undefined) {
    return arg.default;
  }
  switch (arg.type) {
    case "boolean":
      return false;
    case "number":
      return "" as unknown as number;
    case "choice":
      return arg.choices?.[0] ?? "";
    case "text":
      return "";
  }
}

/** One slot's binding picker: New session (default, R3) + same-harness live
 * candidates. Held candidates render disabled. */
function SlotBindingRow({
  slot,
  candidates,
  value,
  onChange,
}: {
  slot: WorkflowRunSlotOption;
  candidates: readonly WorkflowRunSessionCandidate[];
  value: string;
  onChange: (sessionId: string) => void;
}) {
  const options = [
    { value: FRESH_SESSION_CHOICE, label: "New session", triggerLabel: "New session" },
    ...candidates.map((candidate) => ({
      value: candidate.id,
      label: candidate.heldByLabel
        ? `${candidate.title} · held by ${candidate.heldByLabel}`
        : candidate.lastActiveLabel
          ? `${candidate.title} · ${candidate.lastActiveLabel}`
          : candidate.title,
      triggerLabel: candidate.title,
      disabled: Boolean(candidate.heldByLabel),
    })),
  ];
  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex min-w-0 flex-1 items-center gap-1.5">
        <ProviderIcon kind={slot.harness} className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate font-mono text-ui-sm text-foreground">{slot.slot}</span>
        <span className="shrink-0 text-xs text-faint">· {slot.model}</span>
      </span>
      <WorkflowSelect
        ariaLabel={`Session for ${slot.slot}`}
        className="w-48"
        value={value}
        options={options}
        onChange={onChange}
      />
    </div>
  );
}

/** Args form + session binding + run-target selection shown before a run
 * (spec run-from-chat R2/R3/R6; spec 3.2 / 3.6). */
export function WorkflowRunArgsModal({
  open,
  workflowName,
  args,
  localWorkspaces,
  cloudWorkspaces,
  slots,
  sessionCandidates,
  defaultLocalWorkspaceId,
  defaultTargetMode,
  defaultCloudWorkspaceId,
  chatOriginLabel = null,
  hasIntegrations = false,
  busy = false,
  error = null,
  onOpenIntegrationsSettings,
  onClose,
  onSubmit,
}: WorkflowRunArgsModalProps) {
  const initial = useMemo(() => {
    const map: Record<string, ArgValue> = {};
    for (const arg of args) {
      map[arg.name] = initialValue(arg);
    }
    return map;
  }, [args]);

  const cloudAvailable = cloudWorkspaces.length > 0;

  const [values, setValues] = useState<Record<string, ArgValue>>(initial);
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [targetMode, setTargetMode] = useState<TargetMode>(() => {
    if (defaultTargetMode === "personal_cloud" && cloudAvailable) {
      return "personal_cloud";
    }
    // No last-used default and nothing local to run against — default to
    // cloud rather than a "local" mode with an empty workspace picker.
    if (!defaultTargetMode && localWorkspaces.length === 0 && cloudAvailable) {
      return "personal_cloud";
    }
    return "local";
  });
  const [localWorkspaceId, setLocalWorkspaceId] = useState<string>(
    () =>
      (defaultLocalWorkspaceId
        && localWorkspaces.some((w) => w.id === defaultLocalWorkspaceId)
        ? defaultLocalWorkspaceId
        : localWorkspaces[0]?.id) ?? "",
  );
  const [cloudWorkspaceId, setCloudWorkspaceId] = useState<string>(
    () =>
      (defaultCloudWorkspaceId
        && cloudWorkspaces.some((w) => w.id === defaultCloudWorkspaceId)
        ? defaultCloudWorkspaceId
        : cloudWorkspaces[0]?.id) ?? "",
  );

  // The run's resolved target, in the same id space session candidates use
  // (gap② — `workspaceId` on a candidate is the raw local id, or the cloud
  // synthetic id; see WorkflowSessionCandidateInput/useWorkflowRunLauncher).
  const activeWorkspaceKey =
    targetMode === "local"
      ? localWorkspaceId || null
      : cloudWorkspaceId
        ? cloudWorkspaceSyntheticId(cloudWorkspaceId)
        : null;

  // Same-harness, same-workspace bind candidates per slot (spec run-from-chat;
  // B8/L29 eligibility mirrored client-side via isBindableSessionCandidate).
  const candidatesBySlot = useMemo(() => {
    const map = new Map<string, WorkflowRunSessionCandidate[]>();
    for (const slot of slots ?? []) {
      map.set(
        slot.slot,
        (sessionCandidates ?? []).filter((candidate) =>
          isBindableSessionCandidate(candidate, { harness: slot.harness, workspaceKey: activeWorkspaceKey }),
        ),
      );
    }
    return map;
  }, [slots, sessionCandidates, activeWorkspaceKey]);

  const bindableSlots = useMemo(
    () => (slots ?? []).filter((slot) => (candidatesBySlot.get(slot.slot)?.length ?? 0) > 0),
    [slots, candidatesBySlot],
  );

  // A binding made against one target workspace doesn't carry over when the
  // run location/workspace changes — drop any selection whose candidate fell
  // out of the (now different) eligible list rather than submit a stale id.
  useEffect(() => {
    setBindings((prev) => {
      let changed = false;
      const next: Record<string, string> = {};
      for (const [slot, sessionId] of Object.entries(prev)) {
        const stillEligible = candidatesBySlot.get(slot)?.some((candidate) => candidate.id === sessionId);
        if (stillEligible) {
          next[slot] = sessionId;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [candidatesBySlot]);

  const setValue = (name: string, value: ArgValue) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  };

  const missingRequired = args.some(
    (arg) => arg.required && (values[arg.name] === "" || values[arg.name] === undefined),
  );
  const missingTarget =
    targetMode === "local" ? localWorkspaceId === "" : cloudWorkspaceId === "";

  const boundCount = (slots ?? []).filter((slot) =>
    isExistingSessionChoice(bindings[slot.slot]),
  ).length;

  const handleSubmit = () => {
    const resolved: Record<string, ArgValue> = {};
    for (const arg of args) {
      const value = values[arg.name];
      if (value === "" || value === undefined) {
        continue;
      }
      resolved[arg.name] = arg.type === "number" ? Number(value) : value;
    }
    const sessionBindings: SlotSessionBinding[] = (slots ?? []).map((slot) => ({
      slot: slot.slot,
      sessionId: bindings[slot.slot] ?? FRESH_SESSION_CHOICE,
    }));
    onSubmit({
      args: resolved,
      targetMode,
      localWorkspaceId: targetMode === "local" ? localWorkspaceId : undefined,
      cloudWorkspaceId: targetMode === "personal_cloud" ? cloudWorkspaceId : undefined,
      sessionBindings,
    });
  };

  const targetOptions =
    targetMode === "local" ? localWorkspaces : cloudWorkspaces;

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={`Run ${workflowName}`}
      sizeClassName="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} loading={busy} disabled={missingRequired || missingTarget}>
            Run
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? (
          <div className="flex flex-col gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-ui-sm text-destructive">
            <p>{error}</p>
            {onOpenIntegrationsSettings ? (
              <Button
                type="button"
                variant="unstyled"
                size="unstyled"
                onClick={onOpenIntegrationsSettings}
                className="self-start font-medium underline-offset-2 hover:underline"
              >
                Go to Settings → Integrations
              </Button>
            ) : null}
          </div>
        ) : null}

        {args.map((arg) => (
          <div key={arg.name} className="flex flex-col gap-1.5">
            <Label className="flex items-center gap-1">
              {arg.name}
              {arg.required ? <span className="text-destructive">*</span> : null}
              <span className="text-xs font-normal text-faint">· {arg.type}</span>
            </Label>
            {arg.type === "boolean" ? (
              <Switch
                checked={Boolean(values[arg.name])}
                onChange={(checked) => setValue(arg.name, checked)}
              />
            ) : arg.type === "choice" ? (
              <WorkflowSelect
                ariaLabel={`${arg.name} value`}
                value={String(values[arg.name] ?? "")}
                options={(arg.choices ?? []).map((option) => ({ value: option, label: option }))}
                onChange={(value) => setValue(arg.name, value)}
              />
            ) : (
              <Input
                type={arg.type === "number" ? "number" : "text"}
                value={String(values[arg.name] ?? "")}
                onChange={(event) => setValue(arg.name, event.target.value)}
                placeholder={arg.required ? "Required" : "Optional"}
              />
            )}
          </div>
        ))}

        {bindableSlots.length > 0 ? (
          <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
            <Label className="flex items-center gap-1.5">
              Sessions
              <span className="text-xs font-normal text-faint">
                · fresh by default{boundCount > 0 ? ` · ${boundCount} bound` : ""}
              </span>
            </Label>
            <div className="flex flex-col gap-2">
              {bindableSlots.map((slot) => (
                <SlotBindingRow
                  key={slot.slot}
                  slot={slot}
                  candidates={candidatesBySlot.get(slot.slot) ?? []}
                  value={bindings[slot.slot] ?? FRESH_SESSION_CHOICE}
                  onChange={(sessionId) =>
                    setBindings((prev) => ({ ...prev, [slot.slot]: sessionId }))
                  }
                />
              ))}
            </div>
            {boundCount > 0 ? (
              <p className="text-xs text-faint">
                Bound sessions are handed to the run and locked until it finishes or you take over.
              </p>
            ) : null}
          </div>
        ) : null}

        {chatOriginLabel !== null ? (
          // Chat origin (R1 door 1): the target is implicit — the workspace
          // the composer lives in — so no picker row is rendered (spec
          // run-from-chat). Read-only line only.
          <p className="border-t border-border/60 pt-3 text-ui-sm text-faint">
            Runs in <span className="text-foreground">{chatOriginLabel}</span> · this chat
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-1.5 border-t border-border/60 pt-3">
              <Label>Run location</Label>
              <WorkflowSelect
                ariaLabel="Run location"
                value={targetMode}
                options={[
                  { value: "local", label: "On this Mac" },
                  ...(cloudAvailable ? [{ value: "personal_cloud", label: "Cloud" }] : []),
                ]}
                onChange={(value) => setTargetMode(value as TargetMode)}
              />
            </div>

            {hasIntegrations && targetMode === "local" ? (
              <p className="flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-xs text-warning">
                <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                This workflow grants integrations, which require a cloud run. Running it on this
                Mac will fail with an explicit error at the step that needs them.
              </p>
            ) : null}

            <div className="flex flex-col gap-1.5">
              <Label>Workspace</Label>
              {targetOptions.length > 0 ? (
                <WorkflowSelect
                  ariaLabel="Workspace"
                  value={targetMode === "local" ? localWorkspaceId : cloudWorkspaceId}
                  options={targetOptions.map((option) => ({ value: option.id, label: option.label }))}
                  onChange={(value) =>
                    targetMode === "local" ? setLocalWorkspaceId(value) : setCloudWorkspaceId(value)
                  }
                />
              ) : (
                <p className="text-ui-sm text-faint">
                  {targetMode === "local"
                    ? "No local workspaces yet — open one first."
                    : "No cloud workspaces yet."}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </ModalShell>
  );
}
