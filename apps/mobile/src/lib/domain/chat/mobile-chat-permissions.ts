import type { CloudPendingInteraction } from "@proliferate/cloud-sdk";

export type PermissionInteractionOption = {
  optionId: string;
  label: string;
  kind: string;
};

export function permissionInteractionOptions(
  interaction: CloudPendingInteraction,
): PermissionInteractionOption[] {
  const payload = interaction.payload;
  const event = isRecord(payload?.event) ? payload.event : null;
  const eventPayload = event && isRecord(event.payload) ? event.payload : null;
  const rawOptions = Array.isArray(eventPayload?.options) ? eventPayload.options : [];
  const options = rawOptions
    .filter(isRecord)
    .map((option) => {
      const optionId = readNonEmptyString(option.optionId);
      const label = readNonEmptyString(option.label);
      const kind = readNonEmptyString(option.kind);
      return optionId && label && kind ? { optionId, label, kind } : null;
    })
    .filter((option): option is PermissionInteractionOption => option !== null);
  if (options.length > 0) {
    return options;
  }
  return [
    { optionId: "allow", label: "Allow", kind: "allow_once" },
    { optionId: "reject", label: "Reject", kind: "reject_once" },
  ];
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
