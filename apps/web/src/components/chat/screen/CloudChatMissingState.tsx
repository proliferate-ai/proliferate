import { Button } from "@proliferate/ui/primitives/Button";

export function CloudChatMissingState({
  title,
  onOpenHome,
}: {
  title: string;
  onOpenHome: () => void;
}) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="rounded-lg border border-border bg-card p-6 text-center">
        <h1 className="text-lg font-semibold">{title}</h1>
        <Button className="mt-4" onClick={onOpenHome}>
          Go home
        </Button>
      </div>
    </div>
  );
}
