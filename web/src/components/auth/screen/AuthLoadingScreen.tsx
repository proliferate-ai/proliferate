import { Spinner } from "@proliferate/ui/primitives/Spinner";

export function AuthLoadingScreen() {
  return (
    <div className="flex h-full items-center justify-center bg-background text-foreground">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Spinner className="size-4" />
        Loading account
      </div>
    </div>
  );
}
