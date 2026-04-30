import { describe, expect, it } from "vitest";
import {
  createReviewSetupDraft,
  createReviewSetupReviewerDraft,
  draftToStoredReviewDefaults,
  listReviewPersonaTemplates,
  nextReviewReviewerId,
  resolveReviewPersonaTemplates,
  resolveReviewExecutionModeIdForAgent,
  type ReviewSessionDefaults,
  type ReviewSetupReviewerDraft,
} from "./review-config";

const SESSION_DEFAULTS: ReviewSessionDefaults = {
  agentKind: "codex",
  modelId: "gpt-5.4",
  modeId: "read-only",
};

function reviewer(overrides: Partial<ReviewSetupReviewerDraft>): ReviewSetupReviewerDraft {
  return {
    id: "plan-skeptic",
    label: "Plan skeptic",
    prompt: "Review the plan.",
    agentKind: "codex",
    modelId: "gpt-5.4",
    modeId: "read-only",
    ...overrides,
  };
}

describe("review setup config", () => {
  it("lists separate personality templates by review kind", () => {
    expect(listReviewPersonaTemplates("plan").map((template) => template.id)).toEqual([
      "plan-skeptic",
      "implementation-readiness",
    ]);
    expect(listReviewPersonaTemplates("code").map((template) => template.id)).toEqual([
      "correctness-reviewer",
      "integration-reviewer",
    ]);
  });

  it("resolves stored built-in overrides and appends custom personalities", () => {
    const templates = resolveReviewPersonaTemplates("plan", [
      {
        id: "plan-skeptic",
        label: "Strict plan reviewer",
        prompt: "Be stricter about plan gaps.",
      },
      {
        id: "plan-docs-reviewer",
        label: "Docs reviewer",
        prompt: "Check that docs and user-facing copy are covered.",
      },
    ]);

    expect(templates.map((template) => template.id)).toEqual([
      "plan-skeptic",
      "implementation-readiness",
      "plan-docs-reviewer",
    ]);
    expect(templates[0]).toMatchObject({
      label: "Strict plan reviewer",
      prompt: "Be stricter about plan gaps.",
    });
    expect(templates[2]).toMatchObject({
      label: "Docs reviewer",
    });
  });

  it("creates new reviewer slots from a personality and inherited harness", () => {
    const draft = createReviewSetupReviewerDraft({
      kind: "code",
      sessionDefaults: SESSION_DEFAULTS,
      existingReviewers: [reviewer({ id: "correctness-reviewer" })],
      templateId: "correctness-reviewer",
    });

    expect(draft).toMatchObject({
      id: "correctness-reviewer-2",
      label: "Correctness reviewer",
      agentKind: "codex",
      modelId: "gpt-5.4",
      modeId: "full-access",
    });
  });

  it("creates reviewer slots from resolved settings personalities", () => {
    const templates = resolveReviewPersonaTemplates("code", [
      {
        id: "code-api-reviewer",
        label: "API reviewer",
        prompt: "Focus on SDK and contract edges.",
      },
    ]);
    const draft = createReviewSetupReviewerDraft({
      kind: "code",
      sessionDefaults: SESSION_DEFAULTS,
      existingReviewers: [],
      personalityTemplates: templates,
      templateId: "code-api-reviewer",
    });

    expect(draft).toMatchObject({
      id: "code-api-reviewer",
      label: "API reviewer",
      prompt: "Focus on SDK and contract edges.",
    });
  });

  it("keeps reviewer IDs stable when replacing the selected personality", () => {
    const reviewers = [
      reviewer({ id: "plan-skeptic" }),
      reviewer({ id: "implementation-readiness" }),
    ];

    expect(nextReviewReviewerId("implementation-readiness", reviewers, 1)).toBe(
      "implementation-readiness",
    );
    expect(nextReviewReviewerId("implementation-readiness", reviewers, 0)).toBe(
      "implementation-readiness-2",
    );
  });

  it("uses execution mode defaults for selected reviewer harnesses", () => {
    expect(resolveReviewExecutionModeIdForAgent("codex", "read-only")).toBe("full-access");
    expect(resolveReviewExecutionModeIdForAgent("claude", "missing")).toBe("bypassPermissions");
    expect(resolveReviewExecutionModeIdForAgent("gemini", "missing")).toBe("yolo");
  });

  it("hydrates initial reviewer personalities with inherited harness defaults", () => {
    const draft = createReviewSetupDraft({
      kind: "plan",
      sessionDefaults: SESSION_DEFAULTS,
      storedDefaults: null,
    });

    expect(draft.reviewers).toHaveLength(2);
    expect(draft.reviewers[0]).toMatchObject({
      id: "plan-skeptic",
      label: "Plan skeptic",
      agentKind: "codex",
      modelId: "gpt-5.4",
      modeId: "full-access",
    });
  });

  it("refreshes stored reviewer labels from resolved settings personalities", () => {
    const templates = resolveReviewPersonaTemplates("plan", [
      {
        id: "plan-skeptic",
        label: "Strict plan reviewer",
        prompt: "Use the stricter saved prompt.",
      },
    ]);

    const draft = createReviewSetupDraft({
      kind: "plan",
      sessionDefaults: SESSION_DEFAULTS,
      personalityTemplates: templates,
      storedDefaults: {
        maxRounds: 2,
        autoSendFeedback: true,
        reviewers: [
          reviewer({
            id: "plan-skeptic",
            label: "Local edit",
            prompt: "Local prompt edit.",
          }),
        ],
      },
    });

    expect(draft.reviewers[0]).toMatchObject({
      label: "Strict plan reviewer",
      prompt: "Use the stricter saved prompt.",
    });
  });

  it("does not persist per-run prompt edits over reusable personalities", () => {
    const templates = resolveReviewPersonaTemplates("plan", [
      {
        id: "plan-skeptic",
        label: "Strict plan reviewer",
        prompt: "Use the reusable prompt.",
      },
    ]);
    const stored = draftToStoredReviewDefaults({
      kind: "plan",
      maxRounds: 2,
      autoSendFeedback: true,
      reviewers: [
        reviewer({
          id: "plan-skeptic",
          label: "Local edit",
          prompt: "Local prompt edit.",
        }),
      ],
    }, templates);

    expect(stored.reviewers[0]).toMatchObject({
      label: "Strict plan reviewer",
      prompt: "Use the reusable prompt.",
    });
  });
});
