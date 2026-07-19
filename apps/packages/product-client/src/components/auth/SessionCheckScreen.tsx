import { ProliferateLivingMark } from "@proliferate/product-ui/brand/ProliferateLivingMark";
import { AUTH_GATE_LABELS } from "#product/copy/auth/auth-copy";
import { twMerge } from "@proliferate/ui/utils/tw-merge";

interface SessionCheckScreenProps {
  className?: string;
  resolving?: boolean;
  onResolved?: () => void;
}

export function SessionCheckScreen({
  className,
  resolving = false,
  onResolved,
}: SessionCheckScreenProps) {
  return (
    <div
      className={twMerge(
        "flex min-h-screen flex-col items-center justify-center bg-background p-8",
        className,
      )}
      data-auth-session-check
      data-tauri-drag-region="true"
    >
      <div className="w-full max-w-md space-y-8">
        <div className="space-y-5">
          <ProliferateLivingMark complete={resolving} onResolved={onResolved} />
          <div className="space-y-2.5">
            <h1 className="text-hero font-semibold text-foreground">
              {AUTH_GATE_LABELS.loadingMessage}
            </h1>
            <p className="text-sm text-muted-foreground">
              {AUTH_GATE_LABELS.loadingSubtext}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
