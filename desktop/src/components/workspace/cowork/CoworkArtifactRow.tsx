import type { CoworkArtifactSummary } from "@anyharness/sdk";
import { FileText } from "@/components/ui/icons";
import { SidebarRowSurface } from "@/components/workspace/shell/sidebar/SidebarRowSurface";
import { resolveCoworkArtifactTitle } from "@/lib/domain/cowork/artifacts";

interface CoworkArtifactRowProps {
  artifact: CoworkArtifactSummary;
  active: boolean;
  onSelect: () => void;
}

export function CoworkArtifactRow({
  artifact,
  active,
  onSelect,
}: CoworkArtifactRowProps) {
  return (
    <SidebarRowSurface
      active={active}
      onPress={onSelect}
      className="items-start gap-2 px-2.5 py-2"
    >
      <FileText className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">
          {resolveCoworkArtifactTitle(artifact)}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {artifact.path}
        </div>
        {!artifact.exists && (
          <div className="pt-1 text-[11px] text-destructive">
            File missing
          </div>
        )}
      </div>
    </SidebarRowSurface>
  );
}
