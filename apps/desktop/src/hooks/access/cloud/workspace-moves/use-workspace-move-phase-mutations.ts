import "@/lib/access/cloud/client";
import {
  useCompleteWorkspaceMove,
  useCutoverWorkspaceMove,
  useExportWorkspaceMove,
  useFailWorkspaceMove,
  useInstallWorkspaceMove,
} from "@proliferate/cloud-sdk-react/hooks/workspace-moves";

/**
 * Groups the mutations that advance an in-flight workspace_move through its phases
 * after start -- install (local->cloud only; cloud->local uses `export` instead, spec
 * section 2.3), cutover, complete, and fail. Mirrors the grouped-mutation shape of
 * `useAutomationMutations` (hooks/access/cloud/automations/use-automation-mutations.ts).
 */
export function useWorkspaceMovePhaseMutations() {
  const install = useInstallWorkspaceMove();
  const exportMove = useExportWorkspaceMove();
  const cutover = useCutoverWorkspaceMove();
  const complete = useCompleteWorkspaceMove();
  const fail = useFailWorkspaceMove();

  return {
    install,
    export: exportMove,
    cutover,
    complete,
    fail,
  };
}
