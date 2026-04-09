import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type Ref,
} from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PopoverButton } from "@/components/ui/PopoverButton";

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
}

export function SessionTitleRenamePopover({
  currentTitle,
  trigger,
  onRename,
  externalOpen,
  onOpenChange,
}: SessionTitleRenamePopoverProps) {
  return (
    <PopoverButton
      trigger={trigger}
      triggerMode="contextMenu"
      align="start"
      side="bottom"
      offset={6}
      className="w-72 rounded-xl border border-border bg-popover p-3 shadow-floating"
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
    <div className="space-y-3">
      <div>
        <div className="text-sm font-medium text-foreground">Rename chat</div>
        <div className="mt-1 text-xs text-muted-foreground">
          Two-finger click chat tabs to edit their title.
        </div>
      </div>
      <Input
        ref={inputRef}
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
        className="h-9"
      />
      {error && (
        <div className="text-xs text-destructive">
          {error}
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          disabled={isSaving}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={() => {
            void handleSave();
          }}
          disabled={isSaving}
        >
          {isSaving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}
