import type { SetupHint } from "@anyharness/sdk";
import { Checkbox } from "@/components/ui/Checkbox";
import { Label } from "@/components/ui/Label";
import { Textarea } from "@/components/ui/Textarea";

interface SetupCommandEditorProps {
  hints: SetupHint[];
  currentScript: string;
  onChange: (script: string) => void;
  isLoading: boolean;
}

function isHintEnabled(script: string, command: string): boolean {
  return script.split("\n").some(
    (line) => line.trim() === command.trim(),
  );
}

function toggleHint(script: string, command: string, enable: boolean): string {
  const trimmedCommand = command.trim();
  if (enable) {
    const existing = script.trim();
    return existing ? `${existing}\n${trimmedCommand}` : trimmedCommand;
  }
  return script
    .split("\n")
    .filter((line) => line.trim() !== trimmedCommand)
    .join("\n");
}

function HintRow({
  hint,
  checked,
  onToggle,
}: {
  hint: SetupHint;
  checked: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <Label className="mb-0 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50">
      <Checkbox
        checked={checked}
        onChange={(e) => onToggle(e.target.checked)}
        className="size-3.5 shrink-0 accent-foreground"
      />
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
        {hint.suggestedCommand}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {hint.detectedFile}
      </span>
    </Label>
  );
}

function SkeletonRows() {
  return (
    <div className="flex flex-col gap-1 animate-pulse">
      {[0, 1].map((i) => (
        <div key={i} className="flex items-center gap-2 px-2 py-1.5">
          <div className="size-3.5 rounded bg-muted" />
          <div className="h-3 flex-1 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

export function SetupCommandEditor({
  hints,
  currentScript,
  onChange,
  isLoading,
}: SetupCommandEditorProps) {
  const buildToolHints = hints.filter((h) => h.category === "build_tool");
  const secretSyncHints = hints.filter((h) => h.category === "secret_sync");

  const handleToggle = (command: string, enabled: boolean) => {
    onChange(toggleHint(currentScript, command, enabled));
  };

  return (
    <div className="w-full space-y-3">
      {isLoading ? (
        <SkeletonRows />
      ) : (
        <>
          {buildToolHints.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Detected</p>
              <div className="flex flex-col">
                {buildToolHints.map((hint) => (
                  <HintRow
                    key={hint.id}
                    hint={hint}
                    checked={isHintEnabled(currentScript, hint.suggestedCommand)}
                    onToggle={(enabled) => handleToggle(hint.suggestedCommand, enabled)}
                  />
                ))}
              </div>
            </div>
          )}
          {secretSyncHints.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Sync ignored files</p>
              <div className="flex flex-col">
                {secretSyncHints.map((hint) => (
                  <HintRow
                    key={hint.id}
                    hint={hint}
                    checked={isHintEnabled(currentScript, hint.suggestedCommand)}
                    onToggle={(enabled) => handleToggle(hint.suggestedCommand, enabled)}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">Preview</p>
        <Textarea
          value={currentScript}
          onChange={(e) => onChange(e.target.value)}
          placeholder="One command per line..."
          rows={4}
          className="resize-y font-mono text-[length:var(--readable-code-font-size)] leading-[var(--readable-code-line-height)]"
        />
      </div>
    </div>
  );
}
