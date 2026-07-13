import { ProductPageShell } from "@proliferate/product-ui/layout/ProductPageShell";
import { EmptyState } from "@proliferate/ui/layout/EmptyState";
import { Button } from "@proliferate/ui/primitives/Button";
import { MainSidebarPageShell } from "@/components/workspace/shell/screen/MainSidebarPageShell";

interface WorkflowDefinitionsAccessScreenProps {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function WorkflowDefinitionsAccessScreen({
  title,
  description,
  actionLabel,
  onAction,
}: WorkflowDefinitionsAccessScreenProps) {
  const action = actionLabel && onAction ? (
    <Button type="button" variant="secondary" onClick={onAction}>
      {actionLabel}
    </Button>
  ) : null;

  return (
    <MainSidebarPageShell>
      <ProductPageShell title="Workflows" maxWidthClassName="max-w-5xl" telemetryBlocked>
        <EmptyState title={title} description={description} action={action} />
      </ProductPageShell>
    </MainSidebarPageShell>
  );
}
