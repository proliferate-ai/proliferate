import type {
  McpElicitationField,
  McpElicitationInteractionPayload,
  McpElicitationSubmittedField,
} from "@anyharness/sdk";
import { useState } from "react";
import { useActivePendingInteractionState } from "@/hooks/chat/derived/use-active-pending-session-interactions";
import { useHeldInteractionPayload } from "@/hooks/chat/ui/use-composer-dock-card-presence";
import { useChatMcpElicitationActions } from "@/hooks/chat/workflows/use-chat-mcp-elicitation-actions";
import { ComposerAttachedPanel } from "./ComposerAttachedPanel";
import { McpElicitationFormPanel } from "./McpElicitationFormPanel";
import {
  type McpDraftValue,
} from "./McpElicitationFieldControl";
import { McpElicitationUrlPanel } from "./McpElicitationUrlPanel";

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
      <ComposerAttachedPanel title={title} context={payload.serverName}>
        <McpElicitationUrlPanel
          message={payload.mode.message}
          urlDisplay={payload.mode.urlDisplay}
          revealedUrl={revealedUrl}
          error={error}
          onReveal={() => { void reveal(); }}
          onAccept={() => { void runAction(() => onAccept([])); }}
          onDecline={() => { void runAction(onDecline); }}
          onCancel={() => { void runAction(onCancel); }}
        />
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
    <ComposerAttachedPanel title={title} context={payload.serverName}>
      <McpElicitationFormPanel
        message={formMode.message}
        fields={formFields}
        drafts={drafts}
        error={error}
        onFieldChange={updateDraft}
        onCancel={() => { void runAction(onCancel); }}
        onDecline={() => { void runAction(onDecline); }}
        onSubmit={() => { void acceptForm(); }}
      />
    </ComposerAttachedPanel>
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
  const { pendingMcpElicitation } = useActivePendingInteractionState();
  // Hold the last payload so the card can still render while the dock slot
  // plays its 150ms exit fade after the elicitation resolves.
  const held = useHeldInteractionPayload(pendingMcpElicitation);
  const {
    handleAcceptMcpElicitation,
    handleCancelMcpElicitation,
    handleDeclineMcpElicitation,
    handleRevealMcpElicitationUrl,
  } = useChatMcpElicitationActions();

  if (!held) {
    return null;
  }

  return (
    <McpElicitationCard
      key={held.requestId}
      title={held.title}
      payload={held.mcpElicitation}
      onAccept={handleAcceptMcpElicitation}
      onCancel={handleCancelMcpElicitation}
      onDecline={handleDeclineMcpElicitation}
      onRevealUrl={handleRevealMcpElicitationUrl}
    />
  );
}
