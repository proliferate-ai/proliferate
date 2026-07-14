import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type Ref,
} from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { POPOVER_FRAME_CLASS, PopoverButton } from "@proliferate/ui/primitives/PopoverButton";

interface SessionTitleRenamePopoverProps {
  currentTitle: string;
  trigger: ReactElement<{
    onClick?: (...args: unknown[]) => void;
    onDoubleClick?: (...args: unknown[]) => void;
    onContextMenu?: (...args: unknown[]) => void;
    ref?: Ref<HTMLElement>;
  }>;
  onRename: (title: string) => Promise<unknown>;
  externalOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  triggerMode?: "contextMenu" | "doubleClick";
}

export function SessionTitleRenamePopover({
  currentTitle,
  trigger,
  onRename,
  externalOpen,
  onOpenChange,
  triggerMode = "contextMenu",
}: SessionTitleRenamePopoverProps) {
  return (
    <PopoverButton
      trigger={trigger}
      triggerMode={triggerMode}
      align="start"
      side="bottom"
      offset={6}
      className={`w-64 ${POPOVER_FRAME_CLASS} p-2`}
      externalOpen={externalOpen}
      onOpenChange={onOpenChange}
    >
      {(close) => (
        <SessionTitleRenamePanel
          currentTitle={currentTitle}
          onClose={close}
          onRename={onRename}
        />
      )}
    </PopoverButton>
  );
}

function SessionTitleRenamePanel({
  currentTitle,
  onClose,
  onRename,
}: {
  currentTitle: string;
  onClose: () => void;
  onRename: (title: string) => Promise<unknown>;
}) {
  const [value, setValue] = useState(currentTitle);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue(currentTitle);
    setError(null);
  }, [currentTitle]);

  useEffect(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, []);

  const handleSave = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed || isSaving) {
      onClose();
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      await onRename(trimmed);
      onClose();
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "Could not rename chat.");
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, onClose, onRename, value]);

  return (
    <div className="space-y-2">
      <Input
        ref={inputRef}
        aria-label="Rename chat"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          if (error) {
            setError(null);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void handleSave();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
        disabled={isSaving}
        spellCheck={false}
        maxLength={160}
        className="h-8 text-ui-sm"
        data-telemetry-mask="true"
      />
      {error && (
        <div className="px-0.5 text-ui-sm text-destructive">
          {error}
        </div>
      )}
      <div className="flex items-center justify-between px-0.5 text-base text-muted-foreground">
        <span>{isSaving ? "Saving…" : "↵ save · esc cancel"}</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-ui-sm"
          onClick={() => {
            void handleSave();
          }}
          disabled={isSaving}
        >
          Save
        </Button>
      </div>
    </div>
  );
}
