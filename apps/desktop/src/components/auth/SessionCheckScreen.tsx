import { ProliferateLivingMark } from "@proliferate/product-ui/brand/ProliferateLivingMark";
import { AuthAppearanceBoundary } from "@/components/auth/AuthAppearanceBoundary";
import { AUTH_GATE_LABELS } from "@/copy/auth/auth-copy";
import { twMerge } from "tailwind-merge";

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
    <AuthAppearanceBoundary
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
            <h1 className="text-3xl font-semibold leading-tight text-foreground">
              {AUTH_GATE_LABELS.loadingMessage}
            </h1>
            <p className="text-sm text-muted-foreground">
              {AUTH_GATE_LABELS.loadingSubtext}
            </p>
          </div>
        </div>
      </div>
    </AuthAppearanceBoundary>
  );
}
