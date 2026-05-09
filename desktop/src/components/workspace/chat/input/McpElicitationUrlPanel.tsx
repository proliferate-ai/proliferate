import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { McpElicitationInlineError } from "./McpElicitationInlineError";

const BUTTON_CLASSNAME = "rounded-xl px-2.5 text-sm";

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
          <div className="space-y-1 text-sm">
            <div className="text-muted-foreground">{message}</div>
            <div className="text-xs text-muted-foreground">
              Destination: {urlDisplay}
            </div>
          </div>
          {revealedUrl && (
            <Input
              value={revealedUrl}
              readOnly
              data-telemetry-mask="true"
              className="font-mono text-xs"
            />
          )}
          {error && <McpElicitationInlineError message={error} />}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 pb-3 pt-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className={BUTTON_CLASSNAME}
          onClick={onReveal}
        >
          Reveal URL
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          className={BUTTON_CLASSNAME}
          onClick={onAccept}
        >
          Accept
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className={BUTTON_CLASSNAME}
          onClick={onDecline}
        >
          Decline
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className={BUTTON_CLASSNAME}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
