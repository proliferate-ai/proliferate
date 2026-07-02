import { Input } from "@proliferate/ui/primitives/Input";
import { ComposerCardFooter } from "./ComposerAttachedPanel";
import { McpElicitationInlineError } from "./McpElicitationInlineError";

interface McpElicitationUrlPanelProps {
  message: string;
  urlDisplay: string;
  revealedUrl: string | null;
  error: string | null;
  onReveal: () => void;
  onAccept: () => void;
  onDecline: () => void;
  onCancel: () => void;
}

export function McpElicitationUrlPanel({
  message,
  urlDisplay,
  revealedUrl,
  error,
  onReveal,
  onAccept,
  onDecline,
  onCancel,
}: McpElicitationUrlPanelProps) {
  return (
    <div className="flex max-h-[min(40vh,360px)] flex-col">
      <div className="min-h-0 overflow-y-auto p-3 pb-2">
        <div className="flex flex-col gap-3">
          <div className="space-y-1">
            <div className="text-ui-sm text-muted-foreground">{message}</div>
            <div className="text-ui-sm text-faint">
              Destination: {urlDisplay}
            </div>
          </div>
          {revealedUrl && (
            <Input
              value={revealedUrl}
              readOnly
              data-telemetry-mask="true"
              className="font-mono text-ui-sm"
            />
          )}
          {error && <McpElicitationInlineError message={error} />}
        </div>
      </div>

      <ComposerCardFooter
        secondaryActions={[
          { label: "Reveal URL", onSelect: onReveal },
          { label: "Decline", onSelect: onDecline },
          { label: "Cancel", onSelect: onCancel },
        ]}
        primaryAction={{ label: "Accept", onSelect: onAccept }}
      />
    </div>
  );
}
