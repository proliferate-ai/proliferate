import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useStartCodeReviewMutation,
  useStartPlanReviewMutation,
} from "@anyharness/sdk-react";
import { useNavigate } from "react-router-dom";
import { useAgentCatalog } from "@/hooks/agents/derived/use-agent-catalog";
import { useCloudLaunchModelRegistries } from "@/hooks/access/cloud/agent-catalog/use-cloud-agent-catalog";
import { buildAgentModelGroups } from "@/lib/domain/agents/model-options";
import type { DesktopLaunchModelRegistry as ModelRegistry } from "@/lib/domain/agents/cloud-launch-catalog";
import {
  buildReviewRequest,
  createReviewSetupDraft,
  draftToStoredReviewDefaults,
  resolveReviewExecutionModeIdForAgent,
  type ReviewSessionDefaults,
  type ReviewSetupDraft,
} from "@/lib/domain/reviews/review-config";
import {
  resolveReviewPersonaTemplates,
  type ReviewPersonaTemplate,
} from "@/lib/domain/reviews/review-personas";
import { buildStartingReview } from "@/lib/domain/reviews/review-launch";
import {
  materializeReviewParentSession,
  waitForReviewParentSessionMaterialization,
} from "@/lib/workflows/reviews/review-parent-materialization";
import {
  sessionMaterializationDeps,
} from "@/hooks/sessions/workflows/session-materialization-deps";
import { buildSettingsHref } from "@/lib/domain/settings/navigation";
import { useReviewUiStore } from "@/stores/reviews/review-ui-store";
import { useSessionDirectoryStore } from "@/stores/sessions/session-directory-store";
import { useSessionSelectionStore } from "@/stores/sessions/session-selection-store";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { useToastStore } from "@/stores/toast/toast-store";

const EMPTY_MODEL_REGISTRIES: ModelRegistry[] = [];
const EMPTY_PERSONALITY_TEMPLATES: ReviewPersonaTemplate[] = [];

// Owns review setup dialog form state and submit actions.
// Does not own the rendered dialog component or active review read model.
export function useReviewSetupDialogState() {
  const navigate = useNavigate();
  const selectedWorkspaceId = useSessionSelectionStore((state) => state.selectedWorkspaceId);
  const setup = useReviewUiStore((state) => state.setup);
  const closeSetup = useReviewUiStore((state) => state.closeSetup);
  const beginStartingReview = useReviewUiStore((state) => state.beginStartingReview);
  const clearStartingReviewForToken = useReviewUiStore((state) => state.clearStartingReviewForToken);
  const patchStartingReviewParentSession = useReviewUiStore(
    (state) => state.patchStartingReviewParentSession,
  );
  const reviewDefaultsByKind = useUserPreferencesStore((state) => state.reviewDefaultsByKind);
  const reviewPersonalitiesByKind = useUserPreferencesStore((state) => state.reviewPersonalitiesByKind);
  const setPreference = useUserPreferencesStore((state) => state.set);
  const showToast = useToastStore((state) => state.show);
  const { readyAgents, isLoading: agentsLoading } = useAgentCatalog();
  const modelRegistriesQuery = useCloudLaunchModelRegistries();
  const modelRegistries = modelRegistriesQuery.data ?? EMPTY_MODEL_REGISTRIES;
  const startPlanReviewMutation = useStartPlanReviewMutation({ workspaceId: selectedWorkspaceId });
  const startCodeReviewMutation = useStartCodeReviewMutation({ workspaceId: selectedWorkspaceId });
  const [draft, setDraft] = useState<ReviewSetupDraft | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saveAsDefault, setSaveAsDefault] = useState(false);

  const setupTarget = setup?.target ?? null;
  const parentSessionId = setupTarget?.kind === "plan"
    ? setupTarget.plan.sourceSessionId
    : setupTarget?.parentSessionId ?? null;
  const parentSlot = useSessionDirectoryStore((state) =>
    parentSessionId ? state.entriesById[parentSessionId] ?? null : null
  );
  const sessionDefaults = useMemo<ReviewSessionDefaults | null>(() => {
    if (!parentSlot) {
      return null;
    }
    return {
      agentKind: parentSlot.agentKind,
      modelId: parentSlot.modelId,
      modeId: resolveReviewExecutionModeIdForAgent(parentSlot.agentKind, parentSlot.modeId),
    };
  }, [parentSlot]);
  const modelGroups = useMemo(
    () => buildAgentModelGroups({
      agents: readyAgents,
      modelRegistries,
      selected: null,
    }),
    [modelRegistries, readyAgents],
  );
  const personalityTemplates = useMemo(() => {
    if (!setupTarget) {
      return EMPTY_PERSONALITY_TEMPLATES;
    }
    return resolveReviewPersonaTemplates(
      setupTarget.kind,
      reviewPersonalitiesByKind[setupTarget.kind] ?? [],
    );
  }, [reviewPersonalitiesByKind, setupTarget]);

  useEffect(() => {
    if (!setupTarget || !sessionDefaults) {
      setDraft(null);
      setValidationError(null);
      return;
    }
    const kind = setupTarget.kind;
    setDraft(createReviewSetupDraft({
      kind,
      sessionDefaults,
      storedDefaults: reviewDefaultsByKind[kind],
      personalityTemplates,
    }));
    setValidationError(null);
    setSaveAsDefault(false);
  }, [personalityTemplates, reviewDefaultsByKind, sessionDefaults, setupTarget]);

  const title = useMemo(() => {
    if (!setupTarget) {
      return "Review setup";
    }
    return setupTarget.kind === "plan" ? "Plan review agents" : "Code review agents";
  }, [setupTarget]);

  const submit = useCallback(() => {
    if (!setupTarget || !draft || !parentSessionId) {
      return;
    }
    const { request, error } = buildReviewRequest(draft, parentSessionId);
    if (!request) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    if (saveAsDefault) {
      const nextDefaults = {
        ...reviewDefaultsByKind,
        [draft.kind]: draftToStoredReviewDefaults(draft, personalityTemplates),
      };
      setPreference("reviewDefaultsByKind", nextDefaults);
    }
    const startingReview = buildStartingReview(parentSessionId, draft.kind, request);
    const startingReviewToken = {
      kind: startingReview.kind,
      startedAt: startingReview.startedAt,
    };
    beginStartingReview(startingReview);
    closeSetup();
    void (async () => {
      const materializedParentSessionId = await waitForReviewParentSessionMaterialization(
        parentSessionId,
        sessionMaterializationDeps,
      );
      const materializedRequest = materializeReviewParentSession(
        request,
        materializedParentSessionId,
      );
      const didPatchStartingReview = patchStartingReviewParentSession(
        startingReviewToken,
        materializedParentSessionId,
      );
      if (!didPatchStartingReview) {
        return;
      }
      if (setupTarget.kind === "plan") {
        await startPlanReviewMutation.mutateAsync({
          planId: setupTarget.plan.planId,
          request: materializedRequest,
        });
        return;
      }
      await startCodeReviewMutation.mutateAsync(materializedRequest);
    })().catch((errorValue) => {
      if (clearStartingReviewForToken(startingReviewToken)) {
        showToast(`Failed to start review: ${errorMessage(errorValue)}`);
      }
    });
  }, [
    beginStartingReview,
    clearStartingReviewForToken,
    closeSetup,
    draft,
    parentSessionId,
    patchStartingReviewParentSession,
    personalityTemplates,
    reviewDefaultsByKind,
    saveAsDefault,
    setPreference,
    setupTarget,
    showToast,
    startCodeReviewMutation,
    startPlanReviewMutation,
  ]);

  const managePersonalities = useCallback(() => {
    closeSetup();
    navigate(buildSettingsHref({ section: "review" }));
  }, [closeSetup, navigate]);

  return {
    open: !!setupTarget,
    title,
    draft,
    sessionDefaults,
    modelGroups,
    personalityTemplates,
    anchorRect: setup?.anchorRect ?? null,
    modelsLoading: agentsLoading || modelRegistriesQuery.isLoading,
    parentSessionId,
    validationError,
    isSubmitting: startPlanReviewMutation.isPending || startCodeReviewMutation.isPending,
    saveAsDefault,
    setSaveAsDefault,
    setDraft,
    submit,
    close: closeSetup,
    managePersonalities,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
