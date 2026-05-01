import { useCallback, useEffect, useMemo, useState } from "react";
import type { ModelRegistry } from "@anyharness/sdk";
import {
  useModelRegistriesQuery,
  useStartCodeReviewMutation,
  useStartPlanReviewMutation,
} from "@anyharness/sdk-react";
import { useNavigate } from "react-router-dom";
import { useAgentCatalog } from "@/hooks/agents/use-agent-catalog";
import { buildAgentModelGroups } from "@/lib/domain/agents/model-options";
import {
  buildReviewRequest,
  createReviewSetupDraft,
  draftToStoredReviewDefaults,
  resolveReviewPersonaTemplates,
  resolveReviewExecutionModeIdForAgent,
  type ReviewPersonaTemplate,
  type ReviewSessionDefaults,
  type ReviewSetupDraft,
} from "@/lib/domain/reviews/review-config";
import { buildSettingsHref } from "@/lib/domain/settings/navigation";
import { useReviewUiStore } from "@/stores/reviews/review-ui-store";
import { useHarnessStore } from "@/stores/sessions/harness-store";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";
import { useToastStore } from "@/stores/toast/toast-store";

const EMPTY_MODEL_REGISTRIES: ModelRegistry[] = [];
const EMPTY_PERSONALITY_TEMPLATES: ReviewPersonaTemplate[] = [];

export function useReviewSetupDialogState() {
  const navigate = useNavigate();
  const selectedWorkspaceId = useHarnessStore((state) => state.selectedWorkspaceId);
  const setup = useReviewUiStore((state) => state.setup);
  const closeSetup = useReviewUiStore((state) => state.closeSetup);
  const beginStartingReview = useReviewUiStore((state) => state.beginStartingReview);
  const clearStartingReview = useReviewUiStore((state) => state.clearStartingReview);
  const sessionSlots = useHarnessStore((state) => state.sessionSlots);
  const reviewDefaultsByKind = useUserPreferencesStore((state) => state.reviewDefaultsByKind);
  const reviewPersonalitiesByKind = useUserPreferencesStore((state) => state.reviewPersonalitiesByKind);
  const setPreference = useUserPreferencesStore((state) => state.set);
  const showToast = useToastStore((state) => state.show);
  const { readyAgents, isLoading: agentsLoading } = useAgentCatalog();
  const modelRegistriesQuery = useModelRegistriesQuery();
  const modelRegistries = modelRegistriesQuery.data ?? EMPTY_MODEL_REGISTRIES;
  const startPlanReviewMutation = useStartPlanReviewMutation({ workspaceId: selectedWorkspaceId });
  const startCodeReviewMutation = useStartCodeReviewMutation({ workspaceId: selectedWorkspaceId });
  const [draft, setDraft] = useState<ReviewSetupDraft | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const setupTarget = setup?.target ?? null;
  const parentSessionId = setupTarget?.kind === "plan"
    ? setupTarget.plan.sourceSessionId
    : setupTarget?.parentSessionId ?? null;
  const parentSlot = parentSessionId ? sessionSlots[parentSessionId] ?? null : null;
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
  }, [personalityTemplates, reviewDefaultsByKind, sessionDefaults, setupTarget]);

  const title = useMemo(() => {
    if (!setupTarget) {
      return "Review setup";
    }
    return setupTarget.kind === "plan" ? "Plan review" : "Code review";
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
    const nextDefaults = {
      ...reviewDefaultsByKind,
      [draft.kind]: draftToStoredReviewDefaults(draft, personalityTemplates),
    };
    setPreference("reviewDefaultsByKind", nextDefaults);
    beginStartingReview({
      parentSessionId,
      kind: draft.kind,
      maxRounds: draft.maxRounds,
      autoIterate: draft.autoIterate,
      reviewers: request.reviewers.map((reviewer) => ({
        id: reviewer.personaId,
        label: reviewer.label,
        agentKind: reviewer.agentKind,
        modelId: reviewer.modelId ?? "",
      })),
      startedAt: Date.now(),
    });
    closeSetup();
    const mutation = setupTarget.kind === "plan"
      ? startPlanReviewMutation.mutateAsync({
        planId: setupTarget.plan.planId,
        request,
      })
      : startCodeReviewMutation.mutateAsync(request);

    void mutation.catch((errorValue) => {
      clearStartingReview();
      showToast(`Failed to start review: ${errorMessage(errorValue)}`);
    });
  }, [
    beginStartingReview,
    clearStartingReview,
    closeSetup,
    draft,
    parentSessionId,
    personalityTemplates,
    reviewDefaultsByKind,
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
    setDraft,
    submit,
    close: closeSetup,
    managePersonalities,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
