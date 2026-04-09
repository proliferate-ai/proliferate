import { Button } from "@/components/ui/Button";
import { FileTreeEntryIcon } from "@/components/ui/file-icons";

interface WorkspaceFilePaletteRowProps {
  name: string;
  path: string;
  active: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  buttonRef?: (element: HTMLButtonElement | null) => void;
}

export function WorkspaceFilePaletteRow({
  name,
  path,
  active,
  onClick,
  onMouseEnter,
  buttonRef,
}: WorkspaceFilePaletteRowProps) {
  return (
    <Button
      ref={buttonRef}
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={`h-8 w-full justify-start gap-1.5 rounded-md px-2.5 text-left font-normal transition-colors ${
        active
          ? "bg-sidebar-accent text-sidebar-foreground"
          : "text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
      }`}
    >
      <FileTreeEntryIcon
        name={name}
        path={path}
        kind="file"
        className="size-4 shrink-0"
      />
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden">
        <span className="shrink-0 truncate text-[0.8125rem] leading-none text-sidebar-foreground">
          {name}
        </span>
        <span
          className="min-w-0 truncate text-start font-mono text-[0.6875rem] leading-none text-foreground/50 [direction:rtl]"
          title={path}
        >
          <span className="[direction:ltr] [unicode-bidi:plaintext]">
            {path}
          </span>
        </span>
      </span>
    </Button>
  );
}
