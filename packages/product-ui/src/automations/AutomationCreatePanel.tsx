import { type FormEvent, type ReactNode } from "react";
import { Bot, CalendarClock, GitBranch, X } from "lucide-react";

import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Select } from "@proliferate/ui/primitives/Select";
import { Textarea } from "@proliferate/ui/primitives/Textarea";

import { SettingsCard } from "../settings/SettingsCard";
import { SettingsCardRow } from "../settings/SettingsCardRow";
import {
  CloudChatComposerControlStrip,
  type CloudChatComposerControlView,
} from "../chat/CloudChatComposer";

export interface AutomationCreateOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface AutomationCreateFormValues {
  title: string;
  prompt: string;
  ownerKey: string;
  repoKey: string;
  schedulePreset: string;
  scheduleTime: string;
  timezone: string;
}

interface AutomationCreatePanelProps {
  values: AutomationCreateFormValues;
  ownerOptions: readonly AutomationCreateOption[];
  repoOptions: readonly AutomationCreateOption[];
  scheduleOptions: readonly AutomationCreateOption[];
  timezoneOptions: readonly AutomationCreateOption[];
  agentControls: readonly CloudChatComposerControlView[];
  loadingOptions?: boolean;
  submitting?: boolean;
  submitDisabled?: boolean;
  error?: ReactNode;
  timeDisabled?: boolean;
  onChange: (values: AutomationCreateFormValues) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export function AutomationCreatePanel({
  values,
  ownerOptions,
  repoOptions,
  scheduleOptions,
  timezoneOptions,
  agentControls,
  loadingOptions = false,
  submitting = false,
  submitDisabled = false,
  error,
  timeDisabled = false,
  onChange,
  onSubmit,
  onCancel,
}: AutomationCreatePanelProps) {
  const update = <Key extends keyof AutomationCreateFormValues>(
    key: Key,
    value: AutomationCreateFormValues[Key],
  ) => onChange({ ...values, [key]: value });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <SettingsCard>
      <form onSubmit={handleSubmit}>
        <div className="flex items-start justify-between gap-4 border-b border-border-light px-4 py-3">
          <div className="min-w-0 space-y-1">
            <div className="text-sm font-medium text-foreground">New automation</div>
            <p className="max-w-2xl text-xs leading-4 text-muted-foreground">
              Schedule a cloud automation against a configured repo and agent harness.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close create automation"
            onClick={onCancel}
            disabled={submitting}
          >
            <X size={14} />
          </Button>
        </div>

        {error ? (
          <div className="border-b border-border-light px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <div className="grid gap-4 px-4 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field title="Title">
              <Input
                aria-label="Automation title"
                value={values.title}
                placeholder="Daily issue triage"
                onChange={(event) => update("title", event.currentTarget.value)}
              />
            </Field>
            <Field title="Owner">
              <Select
                aria-label="Automation owner"
                value={values.ownerKey}
                onChange={(event) => update("ownerKey", event.currentTarget.value)}
                disabled={submitting || ownerOptions.length === 0}
              >
                {ownerOptions.map((option) => (
                  <option key={option.value} value={option.value} disabled={option.disabled}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field
            title="Prompt"
            description="The scheduled run starts a cloud session with this prompt."
          >
            <Textarea
              aria-label="Automation prompt"
              value={values.prompt}
              rows={5}
              className="resize-none"
              placeholder="Check recent failures and open a concise fix plan."
              onChange={(event) => update("prompt", event.currentTarget.value)}
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field title="Repo" icon={<GitBranch size={14} />}>
              <Select
                aria-label="Automation repo"
                value={values.repoKey}
                onChange={(event) => update("repoKey", event.currentTarget.value)}
                disabled={submitting || loadingOptions || repoOptions.length === 0}
              >
                {repoOptions.length > 0 ? (
                  repoOptions.map((option) => (
                    <option key={option.value} value={option.value} disabled={option.disabled}>
                      {option.label}
                    </option>
                  ))
                ) : (
                  <option value="">No configured repos</option>
                )}
              </Select>
            </Field>
            <Field
              title="Agent"
              icon={<Bot size={14} />}
              description="Select the harness, model, mode, and launch defaults for scheduled runs."
            >
              <div className="rounded-lg border border-border bg-background/40 px-2 py-2">
                <CloudChatComposerControlStrip
                  controls={agentControls}
                  disabled={submitting || loadingOptions || agentControls.length === 0}
                />
              </div>
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_8rem_1.3fr]">
            <Field title="Schedule" icon={<CalendarClock size={14} />}>
              <Select
                aria-label="Automation schedule"
                value={values.schedulePreset}
                onChange={(event) => update("schedulePreset", event.currentTarget.value)}
                disabled={submitting}
              >
                {scheduleOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field title="Time">
              <Input
                aria-label="Automation scheduled time"
                type="time"
                value={values.scheduleTime}
                disabled={submitting || timeDisabled}
                onChange={(event) => update("scheduleTime", event.currentTarget.value)}
              />
            </Field>
            <Field title="Timezone">
              <Select
                aria-label="Automation timezone"
                value={values.timezone}
                onChange={(event) => update("timezone", event.currentTarget.value)}
                disabled={submitting}
              >
                {timezoneOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </div>

        <SettingsCardRow
          label="Create scheduled run"
          description="Web supports cloud-backed automation creation and basic management. Local Desktop-only targets stay out of this flow."
        >
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting} disabled={submitDisabled}>
              Create
            </Button>
          </div>
        </SettingsCardRow>
      </form>
    </SettingsCard>
  );
}

function Field({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon ? <span className="flex size-3.5 items-center justify-center">{icon}</span> : null}
        <span>{title}</span>
      </div>
      {children}
      {description ? <p className="text-xs leading-4 text-muted-foreground">{description}</p> : null}
    </div>
  );
}
