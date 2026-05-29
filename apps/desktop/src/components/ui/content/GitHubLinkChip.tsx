import { GitHub } from "@/components/ui/icons";
import type { ParsedGitHubLink } from "@/lib/domain/links/github-link";

interface GitHubLinkChipProps {
  link: ParsedGitHubLink;
}

export function GitHubLinkChip({ link }: GitHubLinkChipProps) {
  return (
    <a
      href={link.href}
      target="_blank"
      rel="noopener noreferrer"
      data-github-link-chip
      data-github-link-kind={link.kind}
      aria-label={`${link.typeLabel} on GitHub: ${link.label}`}
      className="mx-0.5 inline-flex max-w-full items-center gap-1 rounded-sm border border-border/70 bg-muted/45 px-1.5 py-0.5 align-baseline text-[0.75em] leading-none text-foreground/90 no-underline shadow-none transition-colors hover:border-border hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
    >
      <GitHub className="size-3 shrink-0" aria-hidden="true" />
      <span className="shrink-0 font-medium text-muted-foreground">{link.typeLabel}</span>
      <span className="min-w-0 truncate font-mono">{link.label}</span>
    </a>
  );
}
