import type { ReactNode } from "react";
import { ModalShell } from "@/components/ui/ModalShell";

interface WorkspaceFilePaletteSurfaceProps {
  open: boolean;
  onClose: () => void;
  headerContent: ReactNode;
  children: ReactNode;
}

export function WorkspaceFilePaletteSurface({
  open,
  onClose,
  headerContent,
  children,
}: WorkspaceFilePaletteSurfaceProps) {
  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Open file"
      headerContent={headerContent}
      sizeClassName="max-w-2xl"
      bodyClassName="p-0"
      overlayClassName="bg-overlay/50"
      panelClassName="border-border/70 bg-background shadow-floating-dark"
    >
      {children}
    </ModalShell>
  );
}
