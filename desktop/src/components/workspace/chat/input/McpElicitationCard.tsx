import type {
  McpElicitationField,
  McpElicitationInteractionPayload,
  McpElicitationSubmittedField,
} from "@anyharness/sdk";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Select } from "@/components/ui/Select";
import { useActiveChatSessionState } from "@/hooks/chat/use-active-chat-session-state";
import { useChatMcpElicitationActions } from "@/hooks/chat/use-chat-mcp-elicitation-actions";
import { ComposerAttachedPanel } from "./ComposerAttachedPanel";

const BUTTON_CLASSNAME = "rounded-xl px-2.5 text-sm";

type McpDraftValue = string | boolean | string[];
type McpDrafts = Partial<Record<string, McpDraftValue>>;

export interface McpElicitationCardProps {
  title: string;
  payload: McpElicitationInteractionPayload;
  onAccept: (fields: McpElicitationSubmittedField[]) => Promise<void>;
  onDecline: () => Promise<void>;
  onCancel: () => Promise<void>;
  onRevealUrl: () => Promise<string | null>;
}

export function McpElicitationCard({
  title,
  payload,
  onAccept,
  onDecline,
  onCancel,
  onRevealUrl,
}: McpElicitationCardProps) {
  const [drafts, setDrafts] = useState<McpDrafts>(() => initialDrafts(payload));
  const [error, setError] = useState<string | null>(null);
  const [revealedUrl, setRevealedUrl] = useState<string | null>(null);

  const header = (
    <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
      <div className="text-chat min-w-0 truncate font-medium text-foreground">
        {title}
      </div>
      <div className="shrink-0 text-xs text-muted-foreground">
        {payload.serverName}
      </div>
    </div>
  );

  const runAction = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  if (payload.mode.mode === "url") {
    const reveal = async () => {
      setError(null);
      try {
        const url = await onRevealUrl();
        if (url) setRevealedUrl(url);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    };

    return (
      <ComposerAttachedPanel header={header}>
        <div className="flex flex-col gap-3 p-3">
          <div className="space-y-1 text-sm">
            <div className="text-muted-foreground">{payload.mode.message}</div>
            <div className="text-xs text-muted-foreground">
              Destination: {payload.mode.urlDisplay}
            </div>
          </div>
          {revealedUrl && (
            <Input
              value={revealedUrl}
              readOnly
              data-telemetry-mask="true"
              className="font-mono text-xs"
            />
          )}
          {error && <InlineError message={error} />}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className={BUTTON_CLASSNAME}
              onClick={() => { void reveal(); }}
            >
              Reveal URL
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              className={BUTTON_CLASSNAME}
              onClick={() => { void runAction(() => onAccept([])); }}
            >
              Accept
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className={BUTTON_CLASSNAME}
              onClick={() => { void runAction(onDecline); }}
            >
              Decline
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className={BUTTON_CLASSNAME}
              onClick={() => { void runAction(onCancel); }}
            >
              Cancel
            </Button>
          </div>
        </div>
      </ComposerAttachedPanel>
    );
  }

  const updateDraft = (fieldId: string, value: McpDraftValue) => {
    setDrafts((current) => ({ ...current, [fieldId]: value }));
  };
  const formMode = payload.mode;
  const formFields = formMode.mode === "form" ? formMode.fields ?? [] : [];

  const acceptForm = async () => {
    setError(null);
    const result = buildSubmittedFields(formFields, drafts);
    if (typeof result === "string") {
      setError(result);
      return;
    }
    try {
      await onAccept(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <ComposerAttachedPanel header={header}>
      <div className="flex flex-col gap-3 p-3">
        <div className="text-sm text-muted-foreground">
          {formMode.message}
        </div>
        <div className="flex flex-col gap-3">
          {formFields.map((field) => (
            <McpFieldControl
              key={field.fieldId}
              field={field}
              value={drafts[field.fieldId]}
              onChange={(value) => updateDraft(field.fieldId, value)}
            />
          ))}
        </div>
        {error && <InlineError message={error} />}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className={BUTTON_CLASSNAME}
            onClick={() => { void runAction(onCancel); }}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className={BUTTON_CLASSNAME}
            onClick={() => { void runAction(onDecline); }}
          >
            Decline
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            className={BUTTON_CLASSNAME}
            onClick={() => { void acceptForm(); }}
          >
            Submit
          </Button>
        </div>
      </div>
    </ComposerAttachedPanel>
  );
}

function McpFieldControl({
  field,
  value,
  onChange,
}: {
  field: McpElicitationField;
  value: McpDraftValue | undefined;
  onChange: (value: McpDraftValue) => void;
}) {
  const description = field.description ? (
    <div className="mt-1 text-xs text-muted-foreground">{field.description}</div>
  ) : null;
  const label = `${field.label}${field.required ? " *" : ""}`;

  if (field.fieldType === "boolean") {
    return (
      <div>
        <div className="flex items-center gap-2">
          <Checkbox
            checked={Boolean(value)}
            onChange={(event) => onChange(event.currentTarget.checked)}
          />
          <Label className="mb-0 text-sm text-foreground">{label}</Label>
        </div>
        {description}
      </div>
    );
  }

  if (field.fieldType === "single_select") {
    return (
      <FieldFrame label={label} description={description}>
        <Select
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.currentTarget.value)}
        >
          <option value="">Choose an option</option>
          {(field.options ?? []).map((option) => (
            <option key={option.optionId} value={option.optionId}>
              {option.label}
            </option>
          ))}
        </Select>
      </FieldFrame>
    );
  }

  if (field.fieldType === "multi_select") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <FieldFrame label={label} description={description}>
        <div className="flex flex-col gap-2">
          {(field.options ?? []).map((option) => (
            <Button
              key={option.optionId}
              type="button"
              variant={selected.includes(option.optionId) ? "primary" : "secondary"}
              size="sm"
              className="h-auto justify-start rounded-xl px-3 py-2 text-left"
              onClick={() => {
                onChange(selected.includes(option.optionId)
                  ? selected.filter((entry) => entry !== option.optionId)
                  : [...selected, option.optionId]);
              }}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </FieldFrame>
    );
  }

  return (
    <FieldFrame label={label} description={description}>
      <Input
        type={field.fieldType === "number" ? "number" : "text"}
        value={typeof value === "string" ? value : ""}
        min={field.fieldType === "number" ? field.minimum ?? undefined : undefined}
        max={field.fieldType === "number" ? field.maximum ?? undefined : undefined}
        onChange={(event) => onChange(event.currentTarget.value)}
        data-telemetry-mask="true"
      />
    </FieldFrame>
  );
}

function FieldFrame({
  label,
  description,
  children,
}: {
  label: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
      {description}
    </div>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
      {message}
    </div>
  );
}

function initialDrafts(payload: McpElicitationInteractionPayload): McpDrafts {
  if (payload.mode.mode !== "form") return {};
  const drafts: McpDrafts = {};
  for (const field of payload.mode.fields ?? []) {
    if (field.fieldType === "boolean") {
      if (field.required) drafts[field.fieldId] = false;
    } else if (field.fieldType === "multi_select") {
      drafts[field.fieldId] = [];
    } else {
      drafts[field.fieldId] = "";
    }
  }
  return drafts;
}

function buildSubmittedFields(
  fields: McpElicitationField[],
  drafts: McpDrafts,
): McpElicitationSubmittedField[] | string {
  const submitted: McpElicitationSubmittedField[] = [];
  for (const field of fields) {
    const value = drafts[field.fieldId];
    if (field.fieldType === "boolean") {
      if (typeof value !== "boolean") {
        if (field.required) return `${field.label} is required.`;
        continue;
      }
      submitted.push({
        fieldId: field.fieldId,
        value: { type: "boolean", value },
      });
      continue;
    }

    if (field.fieldType === "multi_select") {
      const optionIds = Array.isArray(value) ? value : [];
      if (field.required && optionIds.length === 0) {
        return `${field.label} is required.`;
      }
      if (field.minItems != null && optionIds.length < field.minItems) {
        return `${field.label} needs at least ${field.minItems} option${field.minItems === 1 ? "" : "s"}.`;
      }
      if (field.maxItems != null && optionIds.length > field.maxItems) {
        return `${field.label} allows at most ${field.maxItems} option${field.maxItems === 1 ? "" : "s"}.`;
      }
      if (optionIds.length > 0) {
        submitted.push({
          fieldId: field.fieldId,
          value: { type: "option_array", option_ids: optionIds },
        });
      }
      continue;
    }

    const textValue = typeof value === "string" ? value.trim() : "";
    if (!textValue) {
      if (field.required) return `${field.label} is required.`;
      continue;
    }

    if (field.fieldType === "single_select") {
      submitted.push({
        fieldId: field.fieldId,
        value: { type: "option", option_id: textValue },
      });
    } else if (field.fieldType === "number") {
      const numberValue = Number(textValue);
      if (!Number.isFinite(numberValue)) {
        return `${field.label} must be a valid number.`;
      }
      if (field.integer && !Number.isSafeInteger(numberValue)) {
        return `${field.label} must be a safe integer.`;
      }
      submitted.push({
        fieldId: field.fieldId,
        value: field.integer
          ? { type: "integer", value: numberValue }
          : { type: "number", value: numberValue },
      });
    } else {
      submitted.push({
        fieldId: field.fieldId,
        value: { type: "string", value: textValue },
      });
    }
  }
  return submitted;
}

export function ConnectedMcpElicitationCard() {
  const { pendingMcpElicitation } = useActiveChatSessionState();
  const {
    handleAcceptMcpElicitation,
    handleCancelMcpElicitation,
    handleDeclineMcpElicitation,
    handleRevealMcpElicitationUrl,
  } = useChatMcpElicitationActions();

  if (!pendingMcpElicitation) {
    return null;
  }

  return (
    <McpElicitationCard
      key={pendingMcpElicitation.requestId}
      title={pendingMcpElicitation.title}
      payload={pendingMcpElicitation.mcpElicitation}
      onAccept={handleAcceptMcpElicitation}
      onCancel={handleCancelMcpElicitation}
      onDecline={handleDeclineMcpElicitation}
      onRevealUrl={handleRevealMcpElicitationUrl}
    />
  );
}
