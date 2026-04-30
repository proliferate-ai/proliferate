import { useMemo, useState } from "react";
import type { ReviewKind } from "@anyharness/sdk";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { ModalShell } from "@/components/ui/ModalShell";
import { Textarea } from "@/components/ui/Textarea";
import {
  Brain,
  Pencil,
  Plus,
  RefreshCw,
  Trash,
} from "@/components/ui/icons";
import {
  isBuiltInReviewPersonaId,
  listBuiltInReviewPersonaTemplates,
  resolveReviewPersonaTemplates,
  type ReviewPersonaTemplate,
  type ReviewPersonalityPreference,
} from "@/lib/domain/reviews/review-config";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

const REVIEW_KINDS: { kind: ReviewKind; label: string; description: string }[] = [
  {
    kind: "plan",
    label: "Plan",
    description: "Reviewers that critique proposed implementation plans.",
  },
  {
    kind: "code",
    label: "Code",
    description: "Reviewers that critique implementation changes.",
  },
];
const EMPTY_REVIEW_PERSONALITIES: ReviewPersonalityPreference[] = [];

type PersonalityEditorState =
  | { mode: "create"; kind: ReviewKind }
  | { mode: "edit"; kind: ReviewKind; id: string; builtIn: boolean };

export function ReviewSettingsPane() {
  const [activeKind, setActiveKind] = useState<ReviewKind>("plan");
  const [editor, setEditor] = useState<PersonalityEditorState | null>(null);
  const [labelDraft, setLabelDraft] = useState("");
  const [promptDraft, setPromptDraft] = useState("");
  const [editorError, setEditorError] = useState<string | null>(null);
  const reviewPersonalitiesByKind = useUserPreferencesStore((state) => state.reviewPersonalitiesByKind);
  const setPreference = useUserPreferencesStore((state) => state.set);

  const storedPersonalities = reviewPersonalitiesByKind[activeKind] ?? EMPTY_REVIEW_PERSONALITIES;
  const resolvedPersonalities = useMemo(
    () => resolveReviewPersonaTemplates(activeKind, storedPersonalities),
    [activeKind, storedPersonalities],
  );
  const activeKindDescription = REVIEW_KINDS.find((item) => item.kind === activeKind)?.description ?? "";

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

  const openCreateEditor = () => {
    setEditor({ mode: "create", kind: activeKind });
    setLabelDraft("");
    setPromptDraft("");
    setEditorError(null);
  };

  const openEditEditor = (personality: ReviewPersonaTemplate) => {
    setEditor({
      mode: "edit",
      kind: activeKind,
      id: personality.id,
      builtIn: isBuiltInReviewPersonaId(activeKind, personality.id),
    });
    setLabelDraft(personality.label);
    setPromptDraft(personality.prompt);
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

    if (editor.mode === "create") {
      const usedIds = [
        ...listBuiltInReviewPersonaTemplates(editor.kind).map((personality) => personality.id),
        ...(reviewPersonalitiesByKind[editor.kind] ?? []).map((personality) => personality.id),
      ];
      const id = nextReviewPersonalityId(editor.kind, label, usedIds);
      updatePersonalities(editor.kind, (items) => [...items, { id, label, prompt }]);
    } else {
      updatePersonalities(editor.kind, (items) => {
        const nextEntry = { id: editor.id, label, prompt };
        return items.some((item) => item.id === editor.id)
          ? items.map((item) => item.id === editor.id ? nextEntry : item)
          : [...items, nextEntry];
      });
    }

    closeEditor();
  };

  const deleteCustomPersonality = (personality: ReviewPersonaTemplate) => {
    if (isBuiltInReviewPersonaId(activeKind, personality.id)) {
      return;
    }
    updatePersonalities(activeKind, (items) => items.filter((item) => item.id !== personality.id));
  };

  const resetBuiltInOverride = (personality: ReviewPersonaTemplate) => {
    if (!isBuiltInReviewPersonaId(activeKind, personality.id)) {
      return;
    }
    updatePersonalities(activeKind, (items) => items.filter((item) => item.id !== personality.id));
  };

  return (
    <section className="space-y-6">
      <SettingsPageHeader
        title="Review"
        description="Reusable review personalities for plan and code review loops."
        action={(
          <Button type="button" onClick={openCreateEditor}>
            <Plus className="size-3.5" />
            New personality
          </Button>
        )}
      />

      <div className="flex rounded-lg border border-border bg-card/50 p-1">
        {REVIEW_KINDS.map((item) => (
          <Button
            key={item.kind}
            type="button"
            variant={activeKind === item.kind ? "secondary" : "ghost"}
            className="flex-1"
            onClick={() => setActiveKind(item.kind)}
          >
            {item.label}
          </Button>
        ))}
      </div>

      <SettingsCard>
        <div className="flex items-center justify-between gap-4 p-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">
              {REVIEW_KINDS.find((item) => item.kind === activeKind)?.label} personalities
            </div>
            <div className="text-sm text-muted-foreground">{activeKindDescription}</div>
          </div>
          <div className="shrink-0 rounded-full border border-border bg-background/70 px-2.5 py-1 text-xs text-muted-foreground">
            {resolvedPersonalities.length} available
          </div>
        </div>
        <div className="divide-y divide-border/40">
          {resolvedPersonalities.map((personality) => {
            const builtIn = isBuiltInReviewPersonaId(activeKind, personality.id);
            const overridden = builtIn && storedPersonalities.some((item) => item.id === personality.id);
            return (
              <div key={personality.id} className="flex gap-3 p-3">
                <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-foreground/5 text-muted-foreground">
                  <Brain className="size-4" />
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <div className="truncate text-sm font-medium text-foreground">
                      {personality.label}
                    </div>
                    <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                      {builtIn ? (overridden ? "Built-in override" : "Built-in") : "Custom"}
                    </span>
                  </div>
                  <div className="max-h-10 overflow-hidden text-sm leading-5 text-muted-foreground">
                    {personality.prompt}
                  </div>
                </div>
                <div className="flex shrink-0 items-start gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit ${personality.label}`}
                    onClick={() => openEditEditor(personality)}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  {builtIn ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Reset ${personality.label}`}
                      disabled={!overridden}
                      onClick={() => resetBuiltInOverride(personality)}
                    >
                      <RefreshCw className="size-3.5" />
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${personality.label}`}
                      onClick={() => deleteCustomPersonality(personality)}
                    >
                      <Trash className="size-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </SettingsCard>

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
  const title = editor?.mode === "create" ? "New personality" : "Edit personality";
  return (
    <ModalShell
      open={!!editor}
      onClose={onClose}
      title={title}
      description="Personality prompts are reused by the review setup dialog."
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
            value={promptDraft}
            data-telemetry-mask
            placeholder="Tell this reviewer what to focus on."
            className="min-h-[12rem] leading-relaxed"
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
