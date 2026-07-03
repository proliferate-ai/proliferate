import { useLocalWorkflowRelay } from "@/hooks/access/cloud/workflows/use-local-workflow-relay";

/**
 * Mounts the desktop-lane workflow relay once, at the app root, so it survives
 * route changes (spec 3.2). Renders nothing — it only drives the poll→relay loop
 * for local runs registered in the relay store.
 */
export function WorkflowRelayProvider(): null {
  useLocalWorkflowRelay();
  return null;
}
