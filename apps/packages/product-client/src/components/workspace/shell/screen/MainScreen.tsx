import { StandardWorkspaceShell } from "#product/components/workspace/shell/screen/StandardWorkspaceShell";
import { usePersistedLogicalWorkspaceSelection } from "#product/hooks/workspaces/lifecycle/use-persisted-logical-workspace-selection";
import { useHotSessionIngest } from "#product/hooks/sessions/lifecycle/use-hot-session-ingest";

export function MainScreen({ visible = true }: { visible?: boolean }) {
  usePersistedLogicalWorkspaceSelection();
  useHotSessionIngest();

  return <StandardWorkspaceShell visible={visible} />;
}
