import { MainScreen } from "@/components/workspace/shell/screen/MainScreen";

export function MainPage({
  workspaceVisible = true,
}: {
  workspaceVisible?: boolean;
}) {
  return <MainScreen visible={workspaceVisible} />;
}
