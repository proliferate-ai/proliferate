import { useState } from "react";
import type { WorkflowInputSpec } from "@proliferate/product-domain/workflows/definition";
import type { WorkflowTargetMode } from "@proliferate/product-domain/workflows/model";
import {
  parsePollSignatureMismatches,
  type PollFieldMismatch,
} from "@proliferate/product-domain/workflows/poll-setup";
import { ProliferateClientError } from "@proliferate/cloud-sdk";
// v2 (D17): args → inputs; the card consumes the workflow's declared inputs.
import type {
  WorkflowTriggerCreateRequest,
  WorkflowTriggerResponse,
} from "@/hooks/access/cloud/workflows/types";
import {
  useWorkflowTriggerMutations,
  useWorkflowTriggers,
} from "@/hooks/access/cloud/workflows/use-workflow-triggers";
import {
  defaultAutomationTimezone,
  presetForRrule,
  validateAutomationRrule,
  type AutomationSchedulePresetOrCustom,
} from "@/lib/domain/automations/schedule/schedule";
import type { WorkflowTriggerRepoOption } from "@/components/workflows/editor/WorkflowTriggersCard";

export type ArgValue = string | number | boolean;
export type Concurrency = "skip" | "queue";
export type TriggerKind = "schedule" | "poll";
/** Per-trigger catch-up policy for occurrences missed while the scheduler was
 * down (mental-model §4, RULED). Schedule-only — meaningless for poll triggers,
 * which have no RRULE occurrences to miss. Mirrors the server default. */
export type MissedRunPolicy = "run_latest" | "skip_all" | "replay_all";
const DEFAULT_MISSED_RUN_POLICY: MissedRunPolicy = "run_latest";

export const DEFAULT_RRULE = "RRULE:FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0";
// Mirrors WORKFLOW_POLL_MIN_INTERVAL_SECONDS (server/proliferate/constants/workflows.py).
export const POLL_MIN_INTERVAL_SECS = 60;

export interface TriggerDraft {
  kind: TriggerKind;
  // schedule fields
  rrule: string;
  timezone: string;
  preset: AutomationSchedulePresetOrCustom;
  /** D-028①: SCHEDULE-only location (cloud workspace vs. "On this Mac", 2a).
   * Poll stays cloud-only — always "personal_cloud" (never surfaced in its form). */
  targetMode: WorkflowTargetMode;
  // poll fields
  pollUrl: string;
  pollAuthHeader: string;
  /** Whether the stored trigger already has an encrypted secret (server-reported). */
  pollHasAuth: boolean;
  /** True once the user opts to type a new secret over an existing one. */
  pollReplaceAuth: boolean;
  pollAuthValue: string;
  pollIntervalSecs: number;
  // The poll item schema is DERIVED server-side from the workflow inputs (D17):
  // no item-schema or args-mapping authoring surface here.
  // common
  concurrency: Concurrency;
  missedRunPolicy: MissedRunPolicy;
  enabled: boolean;
  repoFullName: string;
  argValues: Record<string, ArgValue>;
}

function initialArgValue(arg: WorkflowInputSpec): ArgValue {
  if (arg.default !== undefined) return arg.default;
  switch (arg.type) {
    case "boolean":
      return false;
    case "choice":
      return arg.choices?.[0] ?? "";
    default:
      return "";
  }
}

function draftFromTrigger(
  trigger: WorkflowTriggerResponse | null,
  args: readonly WorkflowInputSpec[],
  repoOptions: readonly WorkflowTriggerRepoOption[],
  localRepoOptions: readonly WorkflowTriggerRepoOption[],
  fallbackKind: TriggerKind,
): TriggerDraft {
  const kind: TriggerKind = (trigger?.kind as TriggerKind | undefined) ?? fallbackKind;
  const rrule = trigger?.schedule?.rrule ?? DEFAULT_RRULE;
  const argValues: Record<string, ArgValue> = {};
  for (const arg of args) {
    const stored = trigger?.args?.[arg.name] as ArgValue | undefined;
    argValues[arg.name] = stored ?? initialArgValue(arg);
  }
  // Poll is always cloud (never surfaced a location picker); a fresh schedule
  // draft defaults to cloud when a cloud repo exists, else local (2a).
  const targetMode: WorkflowTargetMode =
    kind === "poll"
      ? "personal_cloud"
      : (trigger?.targetMode as WorkflowTargetMode | undefined)
        ?? (repoOptions.length > 0 ? "personal_cloud" : "local");
  const activeRepoOptions = targetMode === "local" ? localRepoOptions : repoOptions;
  return {
    kind,
    rrule,
    timezone: trigger?.schedule?.timezone ?? defaultAutomationTimezone(),
    preset: presetForRrule(rrule),
    targetMode,
    pollUrl: trigger?.poll?.url ?? "",
    pollAuthHeader: trigger?.poll?.authHeader ?? "",
    pollHasAuth: trigger?.poll?.hasAuth ?? false,
    pollReplaceAuth: !(trigger?.poll?.hasAuth ?? false),
    pollAuthValue: "",
    pollIntervalSecs: trigger?.poll?.intervalSecs ?? POLL_MIN_INTERVAL_SECS,
    concurrency: (trigger?.concurrencyPolicy as Concurrency) ?? "skip",
    missedRunPolicy: (trigger?.missedRunPolicy as MissedRunPolicy) ?? DEFAULT_MISSED_RUN_POLICY,
    enabled: trigger?.enabled ?? true,
    repoFullName: trigger?.repoFullName ?? activeRepoOptions[0]?.fullName ?? "",
    argValues,
  };
}

function coerceArg(arg: WorkflowInputSpec, value: ArgValue): ArgValue {
  if (arg.type === "number") return value === "" ? "" : Number(value);
  return value;
}

/**
 * Trigger CRUD/draft orchestration for `WorkflowTriggersCard` (WS0B-U): the
 * inline add/edit form's draft state, the schedule/poll validation gates, and
 * the create/update/delete mutation wiring. The card itself only renders.
 */
export function useWorkflowTriggerDrafts(
  workflowId: string,
  args: readonly WorkflowInputSpec[],
  repoOptions: readonly WorkflowTriggerRepoOption[],
  localRepoOptions: readonly WorkflowTriggerRepoOption[],
) {
  const triggersQuery = useWorkflowTriggers(workflowId);
  const { createMutation, updateMutation, deleteMutation } = useWorkflowTriggerMutations(workflowId);

  const triggers = triggersQuery.data ?? [];
  const pollTriggers = triggers.filter((t) => t.kind === "poll");
  const cloudAvailable = repoOptions.length > 0;
  const localAvailable = localRepoOptions.length > 0;
  // Poll never offers local (the poller lane has no claim/missed-run protocol
  // for it yet); schedule can use either lane.
  const scheduleAddDisabled = !cloudAvailable && !localAvailable;
  const pollAddDisabled = !cloudAvailable;

  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [draft, setDraft] = useState<TriggerDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Flow 2 (poll-trigger-from-workflow, mental-model §5): the field-by-field
  // diff from a poll_signature_mismatch's structured `extra_detail.mismatches`
  // (mirrored to the client as `ProliferateClientError.details`) — null for
  // every other error (validation messages, poll_probe_failed, schedule errors).
  const [errorMismatches, setErrorMismatches] = useState<readonly PollFieldMismatch[] | null>(
    null,
  );

  const setFormError = (message: string, mismatches: readonly PollFieldMismatch[] | null = null) => {
    setError(message);
    setErrorMismatches(mismatches);
  };

  const openForm = (trigger: WorkflowTriggerResponse | null, kind: TriggerKind = "schedule") => {
    setError(null);
    setErrorMismatches(null);
    setEditing({ id: trigger?.id ?? null });
    setDraft(draftFromTrigger(trigger, args, repoOptions, localRepoOptions, kind));
  };

  const closeForm = () => {
    setEditing(null);
    setDraft(null);
    setError(null);
    setErrorMismatches(null);
  };

  const patchDraft = (patch: Partial<TriggerDraft>) =>
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));

  const busy = createMutation.isPending || updateMutation.isPending;

  const submit = () => {
    if (!draft) return;
    if (!draft.repoFullName) {
      setFormError(`Pin a repository for the ${draft.kind === "poll" ? "polled" : "scheduled"} run.`);
      return;
    }

    if (draft.kind === "poll") {
      const url = draft.pollUrl.trim();
      if (!url || !(url.startsWith("http://") || url.startsWith("https://"))) {
        setFormError("Enter a valid poll URL (http:// or https://).");
        return;
      }
      if (draft.pollIntervalSecs < POLL_MIN_INTERVAL_SECS) {
        setFormError(`Poll interval must be at least ${POLL_MIN_INTERVAL_SECS} seconds.`);
        return;
      }
      const authHeader = draft.pollAuthHeader.trim();
      const isCreate = editing?.id === null;
      if (authHeader && !draft.pollAuthValue && (isCreate || draft.pollReplaceAuth)) {
        setFormError("Provide a value for the auth header, or leave the header name blank.");
        return;
      }
      // Required inputs not supplied as a static preset are expected to arrive
      // per-item in the poll item's `data` (matched by name, D17), so there is no
      // author-time "required arg" gate for poll triggers.
      const staticArgs: Record<string, ArgValue> = {};
      for (const arg of args) {
        const value = coerceArg(arg, draft.argValues[arg.name] ?? "");
        if (value !== "") staticArgs[arg.name] = value;
      }

      const body: WorkflowTriggerCreateRequest = {
        kind: "poll",
        enabled: draft.enabled,
        concurrencyPolicy: draft.concurrency,
        // Not user-configurable for poll (no RRULE occurrences to miss) — the
        // server requires the field regardless, so send the shared default.
        missedRunPolicy: DEFAULT_MISSED_RUN_POLICY,
        targetMode: "personal_cloud",
        repoFullName: draft.repoFullName,
        poll: {
          url,
          authHeader: authHeader || null,
          authValue:
            !authHeader || (!isCreate && !draft.pollReplaceAuth)
              ? undefined
              : draft.pollAuthValue,
          intervalSecs: draft.pollIntervalSecs,
        },
        args: staticArgs,
      };
      // Flow 2 (mental-model §5): a poll_signature_mismatch's structured diff rides
      // ProliferateClientError.details.mismatches — extracted here so the setup UI
      // renders every mismatched field instead of re-parsing the human message.
      const onDone = {
        onSuccess: closeForm,
        onError: (e: Error) => {
          const rawMismatches =
            e instanceof ProliferateClientError ? e.details.mismatches : undefined;
          setFormError(
            e.message,
            Array.isArray(rawMismatches)
              ? parsePollSignatureMismatches(rawMismatches as string[])
              : null,
          );
        },
      };
      if (editing?.id) {
        updateMutation.mutate({ triggerId: editing.id, body }, onDone);
      } else {
        createMutation.mutate(body, onDone);
      }
      return;
    }

    const rruleError = validateAutomationRrule(draft.rrule);
    if (rruleError) {
      setFormError(rruleError);
      return;
    }

    // D16 enable-gate: an enabled schedule must preset every required input; a
    // disabled draft may leave them blank (the server enforces the same gate).
    const missing = args.find(
      (arg) => arg.required && (draft.argValues[arg.name] === "" || draft.argValues[arg.name] === undefined),
    );
    if (draft.enabled && missing) {
      setFormError(`Preset the required input "${missing.name}" before enabling this schedule.`);
      return;
    }
    const argsBody: Record<string, ArgValue> = {};
    for (const arg of args) {
      const value = coerceArg(arg, draft.argValues[arg.name] ?? "");
      if (value !== "") argsBody[arg.name] = value;
    }
    const body: WorkflowTriggerCreateRequest = {
      kind: "schedule",
      enabled: draft.enabled,
      concurrencyPolicy: draft.concurrency,
      missedRunPolicy: draft.missedRunPolicy,
      // D-028①/2a: a local target never carries a cloud workspace — the
      // server's CHECK invariant leaves target_workspace_id null and matches
      // the repo pin against the desktop's local clones at claim time.
      targetMode: draft.targetMode,
      repoFullName: draft.repoFullName,
      schedule: { rrule: draft.rrule, timezone: draft.timezone },
      args: argsBody,
    };
    // Schedule triggers never carry a poll-signature diff.
    const onDone = { onSuccess: closeForm, onError: (e: Error) => setFormError(e.message) };
    if (editing?.id) {
      updateMutation.mutate({ triggerId: editing.id, body }, onDone);
    } else {
      createMutation.mutate(body, onDone);
    }
  };

  const removeTrigger = () => {
    if (!editing?.id) return;
    deleteMutation.mutate(editing.id, { onSuccess: closeForm });
  };

  return {
    triggers,
    pollTriggers,
    cloudAvailable,
    localAvailable,
    scheduleAddDisabled,
    pollAddDisabled,
    editing,
    draft,
    error,
    errorMismatches,
    busy,
    deleting: deleteMutation.isPending,
    openForm,
    closeForm,
    patchDraft,
    submit,
    removeTrigger,
  };
}
