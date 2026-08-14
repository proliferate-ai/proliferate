import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  isWorkflowDefinitionV2,
  type WorkflowDefinitionRecordV2,
  type WorkflowDefinitionV2,
} from "@proliferate/cloud-sdk";
import type { WorkflowStarterTemplateV2 } from "#product/config/workflows/starter-templates";
import { workflowWriteErrorMessage } from "#product/domain/workflows/definition";
import {
  validateDefinitionV2,
  type DefinitionV2Issue,
} from "#product/domain/workflows/definition-v2";
import {
  draftFromRecord,
  draftFromTemplate,
  draftToDefinition,
  serializeDraft,
  workflowBuilderActions,
  type WorkflowBuilderActions,
  type WorkflowBuilderDraft,
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
  /** Exactly what a save would send: card order rendered as a linear edge list. */
  definition: WorkflowDefinitionV2;
  issues: DefinitionV2Issue[];
  /** The persisted record behind the draft; `null` until a new workflow is created. */
  record: WorkflowDefinitionRecordV2 | null;
  dirty: boolean;
  saving: boolean;
  saved: boolean;
  canSave: boolean;
  error: string | null;
  reload: () => void;
  actions: WorkflowBuilderActions;
  save: () => Promise<WorkflowDefinitionRecordV2 | null>;
}

export interface UseWorkflowBuilderArgs {
  /** `null` = a new workflow, seeded from `template` or blank. */
  definitionId: string | null;
  template?: WorkflowStarterTemplateV2 | null;
  authCacheScope: string;
}

/**
 * Draft state for one gen-2 workflow definition: load or seed it, edit it, and
 * write it back.
 *
 * The rules are not this hook's: `validateDefinitionV2` owns them, runs on
 * every change, and its issues are both what the surface renders and the gate
 * `save()` refuses to cross. Edges are never edited — the chain is the card
 * order and `draftToDefinition` renders it — so the linearity rule holds by
 * construction.
 */
export function useWorkflowBuilder({
  definitionId,
  template = null,
  authCacheScope,
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
  // The builder's validation IS the shared validator; every rule the cards
  // display comes from here and nowhere else.
  const issues = useMemo(() => validateDefinitionV2(definition), [definition]);

  const editDraft = useCallback((
    edit: (draft: WorkflowBuilderDraft) => WorkflowBuilderDraft,
  ) => {
    // Any edit clears the "Saved" flash and the last write's error: both
    // describe the draft as it was, not as it now is.
    setState((previous) => ({
      ...previous,
      draft: edit(previous.draft),
      status: "idle",
      error: null,
    }));
  }, []);

  const actions = useMemo(() => workflowBuilderActions(editDraft), [editDraft]);

  const dirty = serializeDraft(state.draft) !== state.baseline;
  const saving = state.status === "saving";
  // Title is not a definition rule — the validator owns the definition
  // document, and title lives on the record envelope beside it — but it is a
  // required wire field, so an untitled draft is refused here rather than at
  // the server.
  const titled = state.draft.title.trim().length > 0;
  const canSave = issues.length === 0 && titled && !saving && (dirty || record === null);

  const inFlight = useRef(false);
  const save = useCallback(async (): Promise<WorkflowDefinitionRecordV2 | null> => {
    // The hard gate: an invalid definition makes no request at all, so a
    // failed save is always the server's answer and never the UI's.
    if (issues.length > 0 || !titled || inFlight.current) {
      return null;
    }
    inFlight.current = true;
    setState((previous) => ({ ...previous, status: "saving", error: null }));
    const title = state.draft.title.trim();
    const description = state.draft.description.trim();
    try {
      const saved = record
        ? await updateWorkflowDefinitionV2({
          workflowDefinitionId: record.id,
          body: {
            title,
            description,
            // Carried through rather than dropped: the builder has no
            // repository picker, and omitting the field on a full-document
            // PUT would silently clear the default the trigger dialog reads.
            defaultRepoConfigId: record.defaultRepoConfigId,
            definition,
            expectedRevision: record.revision,
          },
        })
        : await createWorkflowDefinitionV2({ title, description, definition });
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
    issues,
    record,
    state.draft,
    titled,
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
    error: state.error,
    reload,
    actions,
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
}

function seedState(seedKey: string, draft: WorkflowBuilderDraft): BuilderState {
  return { seedKey, draft, baseline: serializeDraft(draft), status: "idle", error: null };
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
