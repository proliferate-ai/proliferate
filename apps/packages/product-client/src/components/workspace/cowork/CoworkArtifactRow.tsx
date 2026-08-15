import type { CoworkArtifactSummary } from "@anyharness/sdk";
import { FileText } from "#product/primitives/icons/workspace";
import { SidebarRowSurface } from "#product/primitives/patterns/sidebar/SidebarRowSurface";
import { resolveCoworkArtifactTitle } from "#product/lib/domain/cowork/artifacts";

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
      <FileText className="mt-0.5 icon-paired shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-ui font-medium text-foreground">
          {resolveCoworkArtifactTitle(artifact)}
        </div>
        <div className="truncate text-ui-sm text-muted-foreground">
          {artifact.path}
        </div>
        {!artifact.exists && (
          <div className="pt-1 text-ui text-destructive">
            File missing
          </div>
        )}
      </div>
    </SidebarRowSurface>
  );
}
