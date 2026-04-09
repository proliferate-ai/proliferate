import { ProliferateIconLoading } from "@/components/ui/icons";

/**
 * Full loading state: icon + message + optional subtext.
 */
export function LoadingState({
  message = "Loading",
  subtext,
}: {
  message?: string;
  subtext?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 px-6">
      <ProliferateIconLoading className="text-4xl text-foreground" />
      <div className="text-center mt-1">
        <p className="text-sm font-medium text-foreground">{message}</p>
        {subtext && (
          <p className="text-xs text-muted-foreground mt-1">{subtext}</p>
        )}
      </div>
    </div>
  );
}
