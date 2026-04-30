import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { ModalShell } from "@/components/ui/ModalShell";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import {
  AUTOMATION_AGENT_KIND_OPTIONS,
  AUTOMATION_EXECUTION_TARGET_OPTIONS,
  AUTOMATION_PREEXECUTOR_COPY,
  AUTOMATION_REASONING_EFFORT_OPTIONS,
  AUTOMATION_SCHEDULE_PRESET_OPTIONS,
} from "@/config/automations";
import type {
  AutomationResponse,
  CreateAutomationRequest,
  UpdateAutomationRequest,
} from "@/lib/integrations/cloud/client";
import type { AutomationRepositoryOption } from "@/lib/domain/automations/repositories";
import {
  defaultAutomationTimezone,
  presetForRrule,
  rruleForPreset,
  validateAutomationRrule,
  validateAutomationTimezone,
  type AutomationSchedulePreset,
} from "@/lib/domain/automations/schedule";

type SchedulePresetValue = AutomationSchedulePreset | "custom";

interface AutomationEditorModalProps {
  open: boolean;
  automation: AutomationResponse | null;
  repositoryOptions: AutomationRepositoryOption[];
  busy: boolean;
  onClose: () => void;
  onCreate: (body: CreateAutomationRequest) => Promise<void>;
  onUpdate: (automationId: string, body: UpdateAutomationRequest) => Promise<void>;
}

function repoValue(repo: AutomationRepositoryOption): string {
  return `${repo.gitOwner}/${repo.gitRepoName}`;
}

function parseRepoValue(value: string): { gitOwner: string; gitRepoName: string } {
  const [gitOwner, ...rest] = value.split("/");
  return { gitOwner, gitRepoName: rest.join("/") };
}

export function AutomationEditorModal({
  open,
  automation,
  repositoryOptions,
  busy,
  onClose,
  onCreate,
  onUpdate,
}: AutomationEditorModalProps) {
  const firstRepo = repositoryOptions[0] ? repoValue(repositoryOptions[0]) : "";
  const [title, setTitle] = useState(automation?.title ?? "");
  const [prompt, setPrompt] = useState(automation?.prompt ?? "");
  const [repo, setRepo] = useState(
    automation ? `${automation.gitOwner}/${automation.gitRepoName}` : firstRepo,
  );
  const [executionTarget, setExecutionTarget] = useState<"cloud" | "local">(
    automation?.executionTarget ?? "cloud",
  );
  const [schedulePreset, setSchedulePreset] = useState<SchedulePresetValue>(
    automation ? presetForRrule(automation.schedule.rrule) : "daily",
  );
  const [rrule, setRrule] = useState(
    automation?.schedule.rrule ?? rruleForPreset("daily"),
  );
  const [timezone, setTimezone] = useState(
    automation?.schedule.timezone ?? defaultAutomationTimezone(),
  );
  const [agentKind, setAgentKind] = useState(automation?.agentKind ?? "");
  const [modelId, setModelId] = useState(automation?.modelId ?? "");
  const [modeId, setModeId] = useState(automation?.modeId ?? "");
  const [reasoningEffort, setReasoningEffort] = useState(
    automation?.reasoningEffort ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const wasOpenRef = useRef(false);
  const resetAutomationIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      resetAutomationIdRef.current = null;
      return;
    }
    const automationId = automation?.id ?? null;
    const shouldReset = !wasOpenRef.current || resetAutomationIdRef.current !== automationId;
    wasOpenRef.current = true;
    resetAutomationIdRef.current = automationId;
    if (!shouldReset) return;
    setTitle(automation?.title ?? "");
    setPrompt(automation?.prompt ?? "");
    setRepo(automation ? `${automation.gitOwner}/${automation.gitRepoName}` : firstRepo);
    setExecutionTarget(automation?.executionTarget ?? "cloud");
    setSchedulePreset(automation ? presetForRrule(automation.schedule.rrule) : "daily");
    setRrule(automation?.schedule.rrule ?? rruleForPreset("daily"));
    setTimezone(automation?.schedule.timezone ?? defaultAutomationTimezone());
    setAgentKind(automation?.agentKind ?? "");
    setModelId(automation?.modelId ?? "");
    setModeId(automation?.modeId ?? "");
    setReasoningEffort(automation?.reasoningEffort ?? "");
    setError(null);
  }, [automation, firstRepo, open]);

  useEffect(() => {
    if (!open || automation || !firstRepo) return;
    setRepo((current) => current || firstRepo);
  }, [automation, firstRepo, open]);

  const submit = async () => {
    setError(null);
    if (!title.trim() || !prompt.trim()) {
      setError("Add a title and prompt before saving.");
      return;
    }
    if (!automation && !repo) {
      setError("Add a GitHub-backed repository before creating an automation.");
      return;
    }
    if (executionTarget === "cloud" && !agentKind.trim()) {
      setError("Choose an agent before saving a cloud automation.");
      return;
    }
    const timezoneError = validateAutomationTimezone(timezone);
    if (timezoneError) {
      setError(timezoneError);
      return;
    }
    const rruleError = validateAutomationRrule(rrule);
    if (rruleError) {
      setError(rruleError);
      return;
    }
    const schedule = { rrule: rrule.trim(), timezone: timezone.trim() };
    const optionalFields = {
      agentKind: agentKind.trim() || null,
      modelId: modelId.trim() || null,
      modeId: modeId.trim() || null,
      reasoningEffort: reasoningEffort.trim() || null,
    };
    try {
      if (automation) {
        await onUpdate(automation.id, {
          title: title.trim(),
          prompt: prompt.trim(),
          schedule,
          executionTarget,
          ...optionalFields,
        });
      } else {
        const { gitOwner, gitRepoName } = parseRepoValue(repo);
        await onCreate({
          title: title.trim(),
          prompt: prompt.trim(),
          gitOwner,
          gitRepoName,
          schedule,
          executionTarget,
          ...optionalFields,
        });
      }
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to save automation.");
    }
  };

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      disableClose={busy}
      title={automation ? "Edit automation" : "New automation"}
      description={AUTOMATION_PREEXECUTOR_COPY.modalDescription}
      sizeClassName="max-w-2xl"
      bodyClassName="px-5 pb-5 pt-2"
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            {automation ? "Save" : "Create"}
          </Button>
        </>
      )}
    >
      <div className="grid gap-4">
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="automation-title">Title</Label>
          <Input
            id="automation-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Daily repo health check"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="automation-prompt">Prompt</Label>
          <Textarea
            id="automation-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={7}
            placeholder="Inspect the repo, summarize important changes, and open a follow-up issue if needed."
          />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="automation-repo">Repository</Label>
            <Select
              id="automation-repo"
              value={repo}
              onChange={(event) => setRepo(event.target.value)}
              disabled={!!automation || repositoryOptions.length === 0}
            >
              {repositoryOptions.map((item) => (
                <option key={repoValue(item)} value={repoValue(item)}>
                  {item.label}
                </option>
              ))}
            </Select>
            {!automation && repositoryOptions.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Add a local repository with a GitHub remote, or create a cloud workspace first.
              </p>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="automation-target">Execution</Label>
            <Select
              id="automation-target"
              value={executionTarget}
              onChange={(event) => setExecutionTarget(event.target.value as "cloud" | "local")}
            >
              {AUTOMATION_EXECUTION_TARGET_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="automation-schedule">Schedule</Label>
            <Select
              id="automation-schedule"
              value={schedulePreset}
              onChange={(event) => {
                const value = event.target.value as SchedulePresetValue;
                setSchedulePreset(value);
                if (value !== "custom") {
                  setRrule(rruleForPreset(value));
                }
              }}
            >
              {AUTOMATION_SCHEDULE_PRESET_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
              <option value="custom">Custom RRULE</option>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="automation-timezone">Timezone</Label>
            <Input
              id="automation-timezone"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              onBlur={() => setError(validateAutomationTimezone(timezone))}
            />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="automation-rrule">RRULE</Label>
          <Input
            id="automation-rrule"
            value={rrule}
            onChange={(event) => {
              setRrule(event.target.value);
              setSchedulePreset(presetForRrule(event.target.value));
            }}
            onBlur={() => setError(validateAutomationRrule(rrule))}
          />
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          <div className="grid gap-1.5">
            <Label htmlFor="automation-agent">Agent</Label>
            <Select
              id="automation-agent"
              value={agentKind}
              onChange={(event) => setAgentKind(event.target.value)}
            >
              <option value="">
                {executionTarget === "cloud" ? "Select agent" : "Default"}
              </option>
              {AUTOMATION_AGENT_KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="automation-model">Model</Label>
            <Input
              id="automation-model"
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
              placeholder="Default"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="automation-mode">Mode</Label>
            <Input
              id="automation-mode"
              value={modeId}
              onChange={(event) => setModeId(event.target.value)}
              placeholder="Default"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="automation-reasoning">Reasoning</Label>
            <Select
              id="automation-reasoning"
              value={reasoningEffort}
              onChange={(event) => setReasoningEffort(event.target.value)}
            >
              <option value="">Default</option>
              {AUTOMATION_REASONING_EFFORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
