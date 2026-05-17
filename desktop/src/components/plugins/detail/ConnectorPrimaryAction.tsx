import type { ConnectorPrimaryButtonSpec } from "@/lib/domain/mcp/detail-modal";
import { Button } from "@proliferate/ui/primitives/Button";

export function ConnectorPrimaryAction({
  onCancelOAuth,
  onPrimaryAction,
  primary,
  reconnecting,
  submitting,
}: {
  onCancelOAuth: () => void;
  onPrimaryAction: () => void;
  primary: ConnectorPrimaryButtonSpec | null;
  reconnecting: boolean;
  submitting: boolean;
}) {
  if (reconnecting) {
    return (
      <div className="space-y-2">
        <Button
          type="button"
          variant="secondary"
          size="md"
          onClick={onCancelOAuth}
          className="w-full rounded-[10px]"
        >
          Cancel browser sign-in
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Finish authorizing in your browser, or cancel to stop waiting.
        </p>
      </div>
    );
  }

  if (!primary) {
    return null;
  }

  return (
    <Button
      type="button"
      variant="primary"
      size="md"
      onClick={onPrimaryAction}
      loading={submitting}
      disabled={primary.disabled}
      className="w-full rounded-[10px]"
    >
      {primary.label}
    </Button>
  );
}
