export interface PermissionOptionAction {
  optionId: string;
  label: string;
  kind: string | null;
  presentation?: PermissionOptionPresentation | null;
}

export interface PermissionOptionPresentation {
  kind: string;
  placeholder: string | null;
}

export function parsePermissionOptionActions(options: unknown): PermissionOptionAction[] {
  if (!Array.isArray(options)) return [];

  return options.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const raw = entry as Record<string, unknown>;
    const optionId = typeof raw.optionId === "string"
      ? raw.optionId
      : (typeof raw.option_id === "string" ? raw.option_id : null);
    const label = typeof raw.label === "string"
      ? raw.label
      : (typeof raw.name === "string" ? raw.name : null);
    const kind = typeof raw.kind === "string" ? raw.kind : null;
    const presentation = parsePermissionOptionPresentation(raw.presentation);
    if (!optionId || !label) return [];
    return [{ optionId, label, kind, presentation }];
  });
}

function parsePermissionOptionPresentation(value: unknown): PermissionOptionPresentation | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.kind !== "feedback_text_input") return null;
  const placeholder = typeof raw.placeholder === "string"
    ? raw.placeholder
    : null;
  return { kind: raw.kind, placeholder };
}
