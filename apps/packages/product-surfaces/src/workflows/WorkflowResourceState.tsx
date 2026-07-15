import { EmptyState } from "@proliferate/ui/layout/EmptyState";
import { Button } from "@proliferate/ui/primitives/Button";
import { ProductPageShell } from "@proliferate/product-ui/layout/ProductPageShell";

export function WorkflowResourceState({
  loading = false,
  title,
  description,
  onBack,
  onRetry,
}: {
  loading?: boolean;
  title: string;
  description: string;
  onBack: () => void;
  onRetry?: () => void;
}) {
  return (
    <ProductPageShell
      title="Workflows"
      actions={<Button type="button" variant="ghost" onClick={onBack}>Back</Button>}
      maxWidthClassName="max-w-5xl"
      telemetryBlocked
    >
      {loading ? (
        <p className="py-6 text-sm text-muted-foreground" role="status">{title}</p>
      ) : (
        <EmptyState
          title={title}
          description={description}
          action={onRetry ? (
            <Button type="button" variant="secondary" onClick={onRetry}>Retry</Button>
          ) : null}
        />
      )}
    </ProductPageShell>
  );
}
