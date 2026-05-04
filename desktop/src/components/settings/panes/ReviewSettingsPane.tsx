import { useMemo, useState } from "react";
import type { ReviewKind } from "@anyharness/sdk";
import { useModelRegistriesQuery } from "@anyharness/sdk-react";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { ReviewDefaultsSection } from "@/components/settings/panes/review/ReviewDefaultsSection";
import { ReviewPersonalitySection } from "@/components/settings/panes/review/ReviewPersonalitySection";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { ModalShell } from "@/components/ui/ModalShell";
import { Textarea } from "@/components/ui/Textarea";
import {
  isBuiltInReviewPersonaId,
  listBuiltInReviewPersonaTemplates,
  type ReviewPersonaTemplate,
  type ReviewPersonalityPreference,
  type StoredReviewKindDefaults,
} from "@/lib/domain/reviews/review-config";
import { useAgentCatalog } from "@/hooks/agents/use-agent-catalog";
import { buildAgentModelGroups } from "@/lib/domain/agents/model-options";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

const EMPTY_MODEL_REGISTRIES: NonNullable<ReturnType<typeof useModelRegistriesQuery>["data"]> = [];

const REVIEW_SECTIONS: {
  kind: ReviewKind;
  title: string;
  description: string;
  createLabel: string;
}[] = [
  {
    kind: "plan",
    title: "Planning review personalities",
    description: "Prompts used by reviewers that critique proposed implementation plans.",
    createLabel: "New planning personality",
  },
  {
    kind: "code",
    title: "Coding review personalities",
    description: "Prompts used by reviewers that critique implementation changes.",
    createLabel: "New coding personality",
  },
];

const REVIEW_DEFAULT_SECTIONS: {
  kind: ReviewKind;
  title: string;
  description: string;
}[] = [
  {
    kind: "plan",
    title: "Planning review defaults",
    description: "Defaults used by one-click plan review launches.",
  },
  {
    kind: "code",
    title: "Coding review defaults",
    description: "Defaults used by one-click code review launches.",
  },
];

const EMPTY_REVIEW_PERSONALITIES: ReviewPersonalityPreference[] = [];

type PersonalityEditorState = { kind: ReviewKind };

export function ReviewSettingsPane() {
  const [editor, setEditor] = useState<PersonalityEditorState | null>(null);
  const [labelDraft, setLabelDraft] = useState("");
  const [promptDraft, setPromptDraft] = useState("");
  const [editorError, setEditorError] = useState<string | null>(null);
  const reviewDefaultsByKind = useUserPreferencesStore((state) => state.reviewDefaultsByKind);
  const reviewPersonalitiesByKind = useUserPreferencesStore((state) => state.reviewPersonalitiesByKind);
  const setPreference = useUserPreferencesStore((state) => state.set);
  const { agents, isLoading: agentsLoading } = useAgentCatalog();
  const {
    data: modelRegistries = EMPTY_MODEL_REGISTRIES,
    isLoading: modelRegistriesLoading,
  } = useModelRegistriesQuery();
  const modelGroups = useMemo(() => buildAgentModelGroups({
    agents,
    modelRegistries,
    selected: null,
  }), [agents, modelRegistries]);

  const updatePersonalities = (
    kind: ReviewKind,
    updater: (items: ReviewPersonalityPreference[]) => ReviewPersonalityPreference[],
  ) => {
    const current = reviewPersonalitiesByKind[kind] ?? [];
    setPreference("reviewPersonalitiesByKind", {
      ...reviewPersonalitiesByKind,
      [kind]: updater(current),
    });
  };

  const updateReviewDefault = (
    kind: ReviewKind,
    updater: (current: StoredReviewKindDefaults | null) => StoredReviewKindDefaults | null,
  ) => {
    setPreference("reviewDefaultsByKind", {
      ...reviewDefaultsByKind,
      [kind]: updater(reviewDefaultsByKind[kind]),
    });
  };

  const openCreateEditor = (kind: ReviewKind) => {
    setEditor({ kind });
    setLabelDraft("");
    setPromptDraft("");
    setEditorError(null);
  };

  const closeEditor = () => {
    setEditor(null);
    setLabelDraft("");
    setPromptDraft("");
    setEditorError(null);
  };

  const saveEditor = () => {
    if (!editor) {
      return;
    }
    const label = labelDraft.trim();
    const prompt = promptDraft.trim();
    if (!label || !prompt) {
      setEditorError("Add both a label and a prompt.");
      return;
    }

    const usedIds = [
      ...listBuiltInReviewPersonaTemplates(editor.kind).map((personality) => personality.id),
      ...(reviewPersonalitiesByKind[editor.kind] ?? []).map((personality) => personality.id),
    ];
    const id = nextReviewPersonalityId(editor.kind, label, usedIds);
    updatePersonalities(editor.kind, (items) => [...items, { id, label, prompt }]);
    closeEditor();
  };

  const updatePersonalityPrompt = (
    kind: ReviewKind,
    personality: ReviewPersonaTemplate,
    prompt: string,
  ) => {
    updatePersonalities(kind, (items) => {
      const builtInTemplate = listBuiltInReviewPersonaTemplates(kind)
        .find((template) => template.id === personality.id);
      if (
        builtInTemplate
        && prompt === builtInTemplate.prompt
        && personality.label === builtInTemplate.label
      ) {
        return items.filter((item) => item.id !== personality.id);
      }

      const nextEntry = { id: personality.id, label: personality.label, prompt };
      return items.some((item) => item.id === personality.id)
        ? items.map((item) => item.id === personality.id ? nextEntry : item)
        : [...items, nextEntry];
    });
  };

  const deleteCustomPersonality = (
    kind: ReviewKind,
    personality: ReviewPersonaTemplate,
  ) => {
    if (isBuiltInReviewPersonaId(kind, personality.id)) {
      return;
    }
    updatePersonalities(kind, (items) => items.filter((item) => item.id !== personality.id));
  };

  const resetBuiltInOverride = (
    kind: ReviewKind,
    personality: ReviewPersonaTemplate,
  ) => {
    if (!isBuiltInReviewPersonaId(kind, personality.id)) {
      return;
    }
    updatePersonalities(kind, (items) => items.filter((item) => item.id !== personality.id));
  };

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Review"
        description="Defaults and reusable prompts for plan and code review loops."
      />

      {REVIEW_DEFAULT_SECTIONS.map((section, index) => (
        <ReviewDefaultsSection
          key={section.kind}
          title={section.title}
          description={section.description}
          separated={index > 0}
          defaults={reviewDefaultsByKind[section.kind]}
          modelGroups={modelGroups}
          modelsLoading={agentsLoading || modelRegistriesLoading}
          onChange={(updater) => updateReviewDefault(section.kind, updater)}
        />
      ))}

      {REVIEW_SECTIONS.map((section, index) => (
        <ReviewPersonalitySection
          key={section.kind}
          kind={section.kind}
          title={section.title}
          description={section.description}
          createLabel={section.createLabel}
          separated={index > 0}
          storedPersonalities={reviewPersonalitiesByKind[section.kind] ?? EMPTY_REVIEW_PERSONALITIES}
          onCreate={() => openCreateEditor(section.kind)}
          onPromptChange={updatePersonalityPrompt}
          onReset={resetBuiltInOverride}
          onDelete={deleteCustomPersonality}
        />
      ))}

      <PersonalityEditorDialog
        editor={editor}
        labelDraft={labelDraft}
        promptDraft={promptDraft}
        error={editorError}
        onLabelChange={setLabelDraft}
        onPromptChange={setPromptDraft}
        onSave={saveEditor}
        onClose={closeEditor}
      />
    </section>
  );
}

interface PersonalityEditorDialogProps {
  editor: PersonalityEditorState | null;
  labelDraft: string;
  promptDraft: string;
  error: string | null;
  onLabelChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  onSave: () => void;
  onClose: () => void;
}

function PersonalityEditorDialog({
  editor,
  labelDraft,
  promptDraft,
  error,
  onLabelChange,
  onPromptChange,
  onSave,
  onClose,
}: PersonalityEditorDialogProps) {
  const title = editor?.kind === "code"
    ? "New coding personality"
    : "New planning personality";
  return (
    <ModalShell
      open={!!editor}
      onClose={onClose}
      title={title}
      description="Personality prompts are reused by review configuration."
      sizeClassName="max-w-xl"
      footer={(
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={onSave}>
            Save
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
        <Label className="grid gap-1 text-xs text-muted-foreground">
          Name
          <Input
            value={labelDraft}
            placeholder="Architecture reviewer"
            onChange={(event) => onLabelChange(event.target.value)}
          />
        </Label>
        <Label className="grid gap-1 text-xs text-muted-foreground">
          Prompt
          <Textarea
            variant="code"
            rows={6}
            value={promptDraft}
            data-telemetry-mask
            placeholder="Tell this reviewer what to focus on."
            className="min-h-36 px-2.5 py-2 text-sm"
            onChange={(event) => onPromptChange(event.target.value)}
          />
        </Label>
      </div>
    </ModalShell>
  );
}

function nextReviewPersonalityId(
  kind: ReviewKind,
  label: string,
  usedIds: string[],
): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const baseId = `${kind}-${slug || "reviewer"}`;
  const used = new Set(usedIds);
  if (!used.has(baseId)) {
    return baseId;
  }
  for (let index = 2; index <= 100; index += 1) {
    const candidate = `${baseId}-${index}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }
  return `${baseId}-${Date.now()}`;
}
