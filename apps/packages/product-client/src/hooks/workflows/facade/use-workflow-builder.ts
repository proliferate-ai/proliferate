import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  isWorkflowDefinitionV2,
  type WorkflowDefinitionRecordV2,
  type WorkflowDefinitionV2,
} from "@proliferate/cloud-sdk";
import type { WorkflowStarterTemplateV2 } from "#product/config/workflows/starter-templates";
import { workflowWriteErrorMessage } from "#product/domain/workflows/definition";
import {
  workflowBuilderIssues,
  type WorkflowBuilderIssue,
} from "#product/lib/domain/workflows/workflow-builder-validation";
import {
  draftFromRecord,
  draftFromTemplate,
  draftToDefinition,
  serializeDraft,
  workflowBuilderActions,
  type WorkflowBuilderActions,
  type WorkflowBuilderDraft,
  type WorkflowBuilderEditOptions,
} from "#product/lib/domain/workflows/workflow-builder-draft";
import {
  useWorkflowDefinitionV2Access,
  useWorkflowDefinitionV2MutationsAccess,
} from "#product/hooks/access/cloud/workflows/use-workflow-definitions-v2-access";

export type { WorkflowBuilderActions, WorkflowBuilderDraft };

export type WorkflowBuilderStatus = "loading" | "missing" | "unsupported" | "ready";
export type WorkflowBuilderSaveStatus = "idle" | "saving" | "saved";

export interface WorkflowBuilderModel {
  status: WorkflowBuilderStatus;
  draft: WorkflowBuilderDraft;
  /** Exactly what a save would send, including authored real-node edges. */
  definition: WorkflowDefinitionV2;
  issues: WorkflowBuilderIssue[];
  /** The persisted record behind the draft; `null` until a new workflow is created. */
  record: WorkflowDefinitionRecordV2 | null;
  dirty: boolean;
  saving: boolean;
  saved: boolean;
  canSave: boolean;
  /**
   * The draft names a repository the runtime does not list. The picker keeps
   * showing it so nothing is misreported, and the save gate refuses it.
   */
  repoDefaultUnavailable: boolean;
  modelSelectionUnavailable: boolean;
  canUndo: boolean;
  canRedo: boolean;
  error: string | null;
  reload: () => void;
  actions: WorkflowBuilderActions;
  undo: () => void;
  redo: () => void;
  save: () => Promise<WorkflowDefinitionRecordV2 | null>;
}

export interface UseWorkflowBuilderArgs {
  /** `null` = a new workflow, seeded from `template` or blank. */
  definitionId: string | null;
  template?: WorkflowStarterTemplateV2 | null;
  authCacheScope: string;
  /**
   * Repo-root ids the RUNTIME currently lists, or `null` while that list is
   * unknown (still loading, or the runtime is unreachable). Passed in rather
   * than queried here: the runtime plane is the surface's dependency, and the
   * gate below is the only thing this hook needs from it.
   */
  availableRepoRootIds: readonly string[] | null;
  availableModelSelections?: readonly { agentKind: string; modelIds: readonly string[] }[] | null;
}

const HISTORY_LIMIT = 60;
const TYPING_COALESCE_MS = 600;

/**
 * Draft state for one gen-2 workflow definition: load or seed it, edit it, and
 * write it back.
 *
 * The rules are not this hook's: `validateDefinitionV2` owns them, runs on
 * every change, and its issues are both what the surface renders and the gate
 * `save()` refuses to cross. Authored edges and the editor-only Input
 * connection are draft state, so detached or non-linear graphs remain visible
 * but cannot be persisted.
 */
export function useWorkflowBuilder({
  definitionId,
  template = null,
  authCacheScope,
  availableRepoRootIds,
  availableModelSelections = null,
}: UseWorkflowBuilderArgs): WorkflowBuilderModel {
  const detailQuery = useWorkflowDefinitionV2Access(definitionId, authCacheScope);
  const {
    createWorkflowDefinitionV2,
    updateWorkflowDefinitionV2,
  } = useWorkflowDefinitionV2MutationsAccess(authCacheScope);

  // The list/get routes serve gen-1 and gen-2 rows side by side. A gen-1
  // document has no `nodes`, and letting one through would open as an empty
  // chain that the first save would overwrite the original with — so it is
  // refused here, on the SDK's own narrowing guard, rather than coerced.
  const fetchedRecord = detailQuery.data ?? null;
  const loadedRecord = fetchedRecord && isWorkflowDefinitionV2(fetchedRecord.definition)
    ? fetchedRecord
    : null;
  // The record a save produced, held locally so a second save in the same
  // mount targets the row that was just created and carries the revision the
  // server answered with — the list invalidation's refetch is not awaited.
  const [savedRecord, setSavedRecord] = useState<WorkflowDefinitionRecordV2 | null>(null);
  const record = newerRecord(loadedRecord, savedRecord);

  const [state, setState] = useState<BuilderState>(
    () => seedState(templateSeedKey(template), draftFromTemplate(template)),
  );

  // Seeding an existing definition waits on a fetch, so it is an effect rather
  // than the derived-key re-seed `WorkflowTriggerDialog` uses for synchronous
  // prop changes. The seed key makes it fire once per definition: a later
  // refetch (or a poll that returns a newer revision) leaves edits in progress
  // alone instead of overwriting them.
  useEffect(() => {
    if (definitionId === null) {
      const seedKey = templateSeedKey(template);
      setState((previous) => previous.seedKey === seedKey
        ? previous
        : seedState(seedKey, draftFromTemplate(template)));
      return;
    }
    if (!loadedRecord) {
      return;
    }
    const seedKey = `existing:${loadedRecord.id}`;
    setState((previous) => previous.seedKey === seedKey
      ? previous
      : seedState(seedKey, draftFromRecord(loadedRecord)));
  }, [definitionId, loadedRecord, template]);

  const definition = useMemo(() => draftToDefinition(state.draft), [state.draft]);
  // The builder's validation IS the shared validator plus the shared grammar
  // patterns it leaves to the wire models; every rule the cards display comes
  // from `workflowBuilderIssues` and nowhere else.
  const issues = useMemo(
    () => workflowBuilderIssues(definition, state.draft.inputConnectedTo),
    [definition, state.draft.inputConnectedTo],
  );

  const editDraft = useCallback((
    edit: (draft: WorkflowBuilderDraft) => WorkflowBuilderDraft,
    options?: WorkflowBuilderEditOptions,
  ) => {
    // Any edit clears the "Saved" flash and the last write's error: both
    // describe the draft as it was, not as it now is.
    setState((previous) => {
      const draft = edit(previous.draft);
      if (serializeDraft(draft) === serializeDraft(previous.draft)) return previous;
      const now = Date.now();
      const coalesces = options?.coalesceKey !== undefined
        && previous.lastEdit?.key === options.coalesceKey
        && now - previous.lastEdit.at <= TYPING_COALESCE_MS;
      return {
        ...previous,
        draft,
        past: coalesces
          ? previous.past
          : [...previous.past, previous.draft].slice(-HISTORY_LIMIT),
        future: [],
        lastEdit: options?.coalesceKey ? { key: options.coalesceKey, at: now } : null,
        status: "idle",
        error: null,
      };
    });
  }, []);

  const actions = useMemo(() => workflowBuilderActions(editDraft), [editDraft]);
  const undo = useCallback(() => setState((previous) => {
    const draft = previous.past[previous.past.length - 1];
    if (!draft) return previous;
    return {
      ...previous,
      draft,
      past: previous.past.slice(0, -1),
      future: [previous.draft, ...previous.future].slice(0, HISTORY_LIMIT),
      lastEdit: null,
      status: "idle",
      error: null,
    };
  }), []);
  const redo = useCallback(() => setState((previous) => {
    const [draft, ...future] = previous.future;
    if (!draft) return previous;
    return {
      ...previous,
      draft,
      past: [...previous.past, previous.draft].slice(-HISTORY_LIMIT),
      future,
      lastEdit: null,
      status: "idle",
      error: null,
    };
  }), []);

  const dirty = serializeDraft(state.draft) !== state.baseline;
  const saving = state.status === "saving";
  // Title is not a definition rule — the validator owns the definition
  // document, and title lives on the record envelope beside it — but it is a
  // required wire field, so an untitled draft is refused here rather than at
  // the server.
  const titled = state.draft.title.trim().length > 0;
  // Also not a definition rule, and also refused here rather than at the
  // server: the default repository is a runtime repo-root id, and persisting
  // one this runtime does not list would save a default the trigger dialog
  // refuses to launch. A draft with NO default is savable — the dialog asks for
  // a repository at launch time — so an unreachable runtime only blocks the
  // workflows that already name one.
  const repoDefaultUnavailable = state.draft.defaultRepoConfigId.length > 0
    && (availableRepoRootIds === null
      || !availableRepoRootIds.includes(state.draft.defaultRepoConfigId));
  const modelSelectionUnavailable = state.draft.nodes.some((node) => {
    if (!node.model) return false;
    const harness = availableModelSelections?.find(
      (candidate) => candidate.agentKind === node.model?.agentKind,
    );
    return !harness || (node.model.modelId != null && !harness.modelIds.includes(node.model.modelId));
  });
  const savableNow = issues.length === 0 && titled && !repoDefaultUnavailable
    && !modelSelectionUnavailable;
  const canSave = savableNow && !saving && (dirty || record === null);

  const inFlight = useRef(false);
  const save = useCallback(async (): Promise<WorkflowDefinitionRecordV2 | null> => {
    // The hard gate: an invalid definition makes no request at all, so a
    // failed save is always the server's answer and never the UI's.
    if (!savableNow || inFlight.current) {
      return null;
    }
    inFlight.current = true;
    setState((previous) => ({ ...previous, status: "saving", error: null }));
    const title = state.draft.title.trim();
    const description = state.draft.description.trim();
    // Always sent, on create as well as on the full-document PUT: the picker's
    // empty option means "no default", which is `null` on the wire, and
    // omitting the field on an update would instead preserve whatever was
    // stored.
    const defaultRepoConfigId = state.draft.defaultRepoConfigId.trim() || null;
    try {
      const saved = record
        ? await updateWorkflowDefinitionV2({
          workflowDefinitionId: record.id,
          body: {
            title,
            description,
            defaultRepoConfigId,
            definition,
            expectedRevision: record.revision,
          },
        })
        : await createWorkflowDefinitionV2({
          title,
          description,
          defaultRepoConfigId,
          definition,
        });
      setSavedRecord(saved);
      setState((previous) => ({
        ...previous,
        baseline: serializeDraft(previous.draft),
        status: "saved",
        error: null,
      }));
      return saved;
    } catch (error) {
      setState((previous) => ({
        ...previous,
        status: "idle",
        error: workflowWriteErrorMessage(error),
      }));
      return null;
    } finally {
      inFlight.current = false;
    }
  }, [
    createWorkflowDefinitionV2,
    definition,
    record,
    savableNow,
    state.draft,
    updateWorkflowDefinitionV2,
  ]);

  const reload = useCallback(() => {
    void detailQuery.refetch();
  }, [detailQuery]);

  return {
    status: resolveBuilderStatus({
      isNew: definitionId === null,
      hasRecord: loadedRecord !== null,
      fetchedNonV2: fetchedRecord !== null && loadedRecord === null,
      isLoading: detailQuery.isLoading,
    }),
    draft: state.draft,
    definition,
    issues,
    record,
    dirty,
    saving,
    saved: state.status === "saved" && !dirty,
    canSave,
    repoDefaultUnavailable,
    modelSelectionUnavailable,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    error: state.error,
    reload,
    actions,
    undo,
    redo,
    save,
  };
}

/**
 * What the builder shows. A failed passive refetch that still holds a record
 * keeps the editor mounted; only a definition that never arrived is fatal, and
 * a definition that arrived in the gen-1 shape is refused rather than opened.
 */
export function resolveBuilderStatus(input: {
  isNew: boolean;
  hasRecord: boolean;
  fetchedNonV2: boolean;
  isLoading: boolean;
}): WorkflowBuilderStatus {
  if (input.isNew || input.hasRecord) {
    return "ready";
  }
  if (input.fetchedNonV2) {
    return "unsupported";
  }
  return input.isLoading ? "loading" : "missing";
}

interface BuilderState {
  seedKey: string;
  draft: WorkflowBuilderDraft;
  /** The serialized draft as last seeded or saved; `dirty` is a comparison against it. */
  baseline: string;
  status: WorkflowBuilderSaveStatus;
  error: string | null;
  past: WorkflowBuilderDraft[];
  future: WorkflowBuilderDraft[];
  lastEdit: { key: string; at: number } | null;
}

function seedState(seedKey: string, draft: WorkflowBuilderDraft): BuilderState {
  return {
    seedKey,
    draft,
    baseline: serializeDraft(draft),
    status: "idle",
    error: null,
    past: [],
    future: [],
    lastEdit: null,
  };
}

function templateSeedKey(template: WorkflowStarterTemplateV2 | null | undefined): string {
  return `new:${template?.slug ?? "blank"}`;
}

/**
 * Whichever copy of the record is further ahead. A save answers with a newer
 * revision than the query still holds, and the query catches up only after the
 * invalidation's refetch lands.
 */
function newerRecord(
  loaded: WorkflowDefinitionRecordV2 | null,
  saved: WorkflowDefinitionRecordV2 | null,
): WorkflowDefinitionRecordV2 | null {
  if (!saved) {
    return loaded;
  }
  if (!loaded || loaded.id !== saved.id) {
    return loaded ?? saved;
  }
  return saved.revision >= loaded.revision ? saved : loaded;
}
