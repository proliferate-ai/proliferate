import { ArrowRight, X } from "@proliferate/ui/icons";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { IconButton } from "@proliferate/ui/primitives/IconButton";

export interface ReleaseNoticeCardProps {
  notice: {
    version: string;
    title: string;
  };
  onDismiss: () => void;
  onOpenChangelog: () => void;
}

export function ReleaseNoticeCard({
  notice,
  onDismiss,
  onOpenChangelog,
}: ReleaseNoticeCardProps) {
  return (
    <aside
      aria-label={`What's new in ${notice.version}: ${notice.title}`}
      className="mx-2 shrink-0 overflow-hidden rounded-lg border border-sidebar-border bg-foreground/5 px-3 py-3 text-sidebar-foreground"
    >
      <div className="flex min-w-0 items-start gap-2">
        <Badge
          tone="sidebar"
          className="shrink-0"
        >
          NEW
        </Badge>
        <IconButton
          aria-label={`Dismiss release notice for ${notice.version}`}
          title="Dismiss"
          tone="sidebar"
          size="xs"
          className="-mr-1 -mt-1 ml-auto shrink-0"
          onClick={onDismiss}
        >
          <X className="size-3.5" />
        </IconButton>
      </div>

      <p
        className="mt-2 min-w-0 whitespace-normal break-words text-ui font-[520] [overflow-wrap:anywhere]"
        title={notice.title}
      >
        {notice.title}
      </p>

      <Button
        type="button"
        variant="sidebar-link"
        size="unstyled"
        aria-label={`Open changelog for ${notice.version}`}
        className="mt-2 justify-start"
        onClick={onOpenChangelog}
      >
        Changelog
        <ArrowRight className="size-3.5" />
      </Button>
    </aside>
  );
}
