import { Button } from "@/components/ui/Button";
import { ExternalLink } from "@/components/ui/icons";
import { openExternal } from "@/platform/tauri/shell";

interface RunCommandHelpProps {
  scope: string;
  className?: string;
}

const COMMAND_ENVIRONMENT_DOCS_URL =
  "https://github.com/proliferate-ai/proliferate/blob/main/docs/reference/workspace-command-environment.md";

export function RunCommandHelp({
  scope,
  className = "text-sm text-muted-foreground",
}: RunCommandHelpProps) {
  return (
    <p className={className}>
      Runs inside the {scope}.{" "}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="inline-flex h-auto gap-1 px-1 py-0 align-baseline text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
        onClick={() => { void openExternal(COMMAND_ENVIRONMENT_DOCS_URL); }}
      >
        Command environment docs
        <ExternalLink className="size-3" />
      </Button>
    </p>
  );
}
