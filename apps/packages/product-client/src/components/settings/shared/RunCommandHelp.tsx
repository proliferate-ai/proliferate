import { Button } from "#product/primitives/Button";
import { ExternalLink } from "#product/primitives/icons/core";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { COMMAND_ENVIRONMENT_DOCS_URL } from "#product/config/capabilities";

interface RunCommandHelpProps {
  scope: string;
  className?: string;
}

export function RunCommandHelp({
  scope,
  className = "text-ui-sm text-muted-foreground",
}: RunCommandHelpProps) {
  const { openExternal } = useProductHost().links;

  return (
    <p className={className}>
      Runs inside the {scope}.{" "}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="inline-flex h-auto gap-1 px-1 py-0 align-baseline text-ui-sm underline underline-offset-2"
        onClick={() => { void openExternal(COMMAND_ENVIRONMENT_DOCS_URL); }}
      >
        Command environment docs
        <ExternalLink className="icon-compact" />
      </Button>
    </p>
  );
}
