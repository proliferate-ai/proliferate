import type { ReactNode } from "react";
import { AUTOMATION_SCHEDULE_PRESET_OPTIONS, AUTOMATION_TEMPLATE_OPTIONS } from "@/config/automations";
import {
  automationTimezoneOptions,
  formatScheduleControlLabel,
  rruleForPresetAtTime,
  schedulePresetAcceptsTime,
  timeForRrule,
  type AutomationSchedulePresetOrCustom,
} from "@/lib/domain/automations/schedule";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { PillControlButton } from "@/components/ui/PillControlButton";
import { PopoverButton } from "@/components/ui/PopoverButton";
import { PopoverMenuItem } from "@/components/ui/PopoverMenuItem";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import {
  Brain,
  Check,
  Clock,
  Sparkles,
} from "@/components/ui/icons";

interface AutomationControlOption {
  value: string;
  label: string;
  description?: string;
}

interface AutomationSelectPopoverProps {
  label: string;
  value: string;
  options: readonly AutomationControlOption[];
  onChange: (value: string) => void;
  icon: ReactNode;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

interface AutomationSchedulePopoverProps {
  schedulePreset: AutomationSchedulePresetOrCustom;
  rrule: string;
  timezone: string;
  onSchedulePresetChange: (value: AutomationSchedulePresetOrCustom) => void;
  onRruleChange: (value: string) => void;
  onTimezoneChange: (value: string) => void;
  onRruleBlur: () => void;
}

interface AutomationTemplatePopoverProps {
  onSelectTemplate: (template: { title: string; prompt: string }) => void;
}

const POPOVER_CLASS = "w-72 rounded-xl border border-border bg-popover p-1 shadow-floating";

export function AutomationSelectPopover({
  label,
  value,
  options,
  onChange,
  icon,
  placeholder = "Default",
  disabled = false,
  className = "",
}: AutomationSelectPopoverProps) {
  const selected = options.find((option) => option.value === value) ?? null;
  const displayLabel = selected?.label ?? placeholder;

  return (
    <PopoverButton
      trigger={(
        <PillControlButton
          disabled={disabled}
          aria-label={label}
          icon={icon}
          label={displayLabel}
          disclosure
          className={`max-w-[14rem] ${className}`}
        />
      )}
      side="top"
      className={POPOVER_CLASS}
    >
      {(close) => (
        <>
          {options.map((option) => (
            <PopoverMenuItem
              key={option.value}
              label={option.label}
              onClick={() => {
                onChange(option.value);
                close();
              }}
              trailing={option.value === value ? <Check className="size-3.5 text-foreground/70" /> : null}
            >
              {option.description && (
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {option.description}
                </span>
              )}
            </PopoverMenuItem>
          ))}
        </>
      )}
    </PopoverButton>
  );
}

export function AutomationSchedulePopover({
  schedulePreset,
  rrule,
  timezone,
  onSchedulePresetChange,
  onRruleChange,
  onTimezoneChange,
  onRruleBlur,
}: AutomationSchedulePopoverProps) {
  const scheduleLabel = formatScheduleControlLabel(schedulePreset, rrule);
  const timeValue = timeForRrule(rrule);
  const timezoneOptions = automationTimezoneOptions(timezone);

  const selectPreset = (preset: AutomationSchedulePresetOrCustom) => {
    onSchedulePresetChange(preset);
    if (preset !== "custom") {
      onRruleChange(rruleForPresetAtTime(preset, timeValue));
    }
  };

  const updateTime = (nextTime: string) => {
    if (!schedulePresetAcceptsTime(schedulePreset)) return;
    onRruleChange(rruleForPresetAtTime(schedulePreset, nextTime));
  };

  return (
    <PopoverButton
      trigger={(
        <PillControlButton
          aria-label="Schedule"
          icon={<Clock className="size-3.5 shrink-0 text-muted-foreground" />}
          label={scheduleLabel}
          disclosure
          className="max-w-[15rem]"
        />
      )}
      side="top"
      className="w-80 rounded-xl border border-border bg-popover p-1 shadow-floating"
    >
      {() => (
        <div className="space-y-2">
          <div>
            {AUTOMATION_SCHEDULE_PRESET_OPTIONS.map((option) => (
              <PopoverMenuItem
                key={option.value}
                label={option.label}
                onClick={() => selectPreset(option.value)}
                trailing={schedulePreset === option.value ? <Check className="size-3.5 text-foreground/70" /> : null}
              />
            ))}
            <PopoverMenuItem
              label="Custom"
              onClick={() => selectPreset("custom")}
              trailing={schedulePreset === "custom" ? <Check className="size-3.5 text-foreground/70" /> : null}
            >
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                Edit the RRULE directly
              </span>
            </PopoverMenuItem>
          </div>

          <div className="border-t border-border/60 px-2.5 pb-2 pt-3">
            {schedulePresetAcceptsTime(schedulePreset) && (
              <div className="grid gap-1.5">
                <Label htmlFor="automation-schedule-time">Time</Label>
                <Input
                  id="automation-schedule-time"
                  type="time"
                  value={timeValue}
                  onChange={(event) => updateTime(event.target.value)}
                />
              </div>
            )}
            {schedulePreset === "custom" && (
              <div className="grid gap-1.5">
                <Label htmlFor="automation-rrule">RRULE</Label>
                <Textarea
                  id="automation-rrule"
                  value={rrule}
                  onChange={(event) => onRruleChange(event.target.value)}
                  onBlur={onRruleBlur}
                  rows={3}
                  className="font-mono text-xs"
                />
              </div>
            )}
            <div className="mt-3 grid gap-1.5">
              <Label htmlFor="automation-timezone">Timezone</Label>
              <Select
                id="automation-timezone"
                value={timezone}
                onChange={(event) => onTimezoneChange(event.target.value)}
              >
                {timezoneOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </div>
      )}
    </PopoverButton>
  );
}

export function AutomationTemplatePopover({ onSelectTemplate }: AutomationTemplatePopoverProps) {
  return (
    <PopoverButton
      trigger={(
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="shrink-0 bg-card/80"
        >
          <Sparkles className="size-3.5" />
          Use template
        </Button>
      )}
      side="bottom"
      align="end"
      className="w-96 rounded-xl border border-border bg-popover p-1 shadow-floating"
    >
      {(close) => (
        <div className="max-h-80 overflow-y-auto">
          {AUTOMATION_TEMPLATE_OPTIONS.map((template) => (
            <PopoverMenuItem
              key={template.title}
              label={template.title}
              icon={<Sparkles className="size-3.5 text-muted-foreground" />}
              onClick={() => {
                onSelectTemplate(template);
                close();
              }}
            >
              <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                {template.prompt}
              </span>
            </PopoverMenuItem>
          ))}
        </div>
      )}
    </PopoverButton>
  );
}

export function reasoningIcon() {
  return <Brain className="size-3.5" />;
}
