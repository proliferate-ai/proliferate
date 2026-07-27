import { Spinner } from "@proliferate/ui";

export const Sizes = () => (
  <div className="flex items-center gap-4">
    <Spinner className="size-4" />
    <Spinner className="size-5" />
    <Spinner className="size-6" />
  </div>
);

export const InlineWithLabel = () => (
  <div className="flex items-center gap-2">
    <Spinner className="size-4" />
    <span className="text-ui-sm text-muted-foreground">Provisioning sandbox…</span>
  </div>
);
