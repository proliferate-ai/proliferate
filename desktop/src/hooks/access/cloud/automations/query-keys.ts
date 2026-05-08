export function automationsRootKey() {
  return ["automations"] as const;
}

export function automationsListKey() {
  return [...automationsRootKey(), "list"] as const;
}

export function automationDetailKey(automationId: string | null) {
  return [...automationsRootKey(), "detail", automationId] as const;
}

export function automationRunsKey(automationId: string | null) {
  return [...automationsRootKey(), "runs", automationId] as const;
}
