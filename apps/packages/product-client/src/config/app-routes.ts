export const APP_ROUTES = {
  home: "/",
  workflows: "/workflows",
  workspaces: "/workspaces",
  settings: "/settings",
} as const;

export function workflowRunRoute(workflowDefinitionId: string, runId: string): string {
  return `${APP_ROUTES.workflows}/${encodeURIComponent(workflowDefinitionId)}/runs/${encodeURIComponent(runId)}`;
}

export const LEGACY_APP_ROUTES = {
  automations: "/automations",
} as const;
