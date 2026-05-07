export interface PermissionOptionAction {
  optionId: string;
  label: string;
  kind: string | null;
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
    if (!optionId || !label) return [];
    return [{ optionId, label, kind }];
  });
}
