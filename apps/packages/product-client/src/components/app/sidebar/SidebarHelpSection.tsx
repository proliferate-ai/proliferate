import {
  BookMarked,
  BookOpen,
  Globe,
  Lightbulb,
  MessageSquare,
} from "lucide-react";
import { ArrowUpRight, Discord, Mail } from "@proliferate/ui/icons";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import { PROLIFERATE_DOCS_URL } from "#product/config/capabilities";
import { SHORTCUTS } from "#product/config/shortcuts/registry";
import type { WebAppTarget } from "#product/hooks/capabilities/derived/use-web-app-target";
import type { SupportMenuAction } from "#product/lib/domain/support/support-menu-action";
import { getShortcutDisplayLabel } from "#product/lib/domain/shortcuts/matching";

const PROLIFERATE_CHANGELOG_URL = "https://proliferate.com/changelog";
const PROLIFERATE_DISCORD_URL = "https://discord.gg/2RVNNzEZnj";

export interface SidebarHelpSectionProps {
  webApp: WebAppTarget;
  supportAction: SupportMenuAction;
  supportDisabledReason: string | null;
  openSupport: () => void;
  openPrompt: () => void;
  openExternalUrl: (url: string) => void;
  onClose: () => void;
}

/**
 * Documentation/Changelog/Discord (always universal — no gating) plus the
 * capability-gated "Go to web" and support actions:
 *
 * - `supportAction.kind === "vendor"` (hosted): unchanged "Send feedback" /
 *   "Submit a prompt" actions into the vendor support-report window.
 * - `"operator"` (self-managed with a configured destination): a single
 *   "Contact support" action that opens the operator's url/mailto directly.
 * - `"none"` (self-managed with nothing configured): no support action at all.
 *
 * Extracted from `SidebarAccountFooter` to keep that file under the strict
 * frontend line-count threshold.
 */
export function SidebarHelpSection({
  webApp,
  supportAction,
  supportDisabledReason,
  openSupport,
  openPrompt,
  openExternalUrl,
  onClose,
}: SidebarHelpSectionProps) {
  return (
    <div className="py-1">
      {supportAction.kind === "vendor" ? (
        <>
          <PopoverMenuItem
            variant="sidebar"
            label="Send feedback"
            icon={<MessageSquare className="icon-paired [font-size:var(--text-sidebar-row)]" />}
            trailing={<span>{getShortcutDisplayLabel(SHORTCUTS.openSupport)}</span>}
            disabled={Boolean(supportDisabledReason)}
            title={supportDisabledReason ?? undefined}
            onClick={() => {
              openSupport();
              onClose();
            }}
          />
          <PopoverMenuItem
            variant="sidebar"
            label="Submit a prompt"
            icon={<Lightbulb className="icon-paired" />}
            disabled={Boolean(supportDisabledReason)}
            title={supportDisabledReason ?? undefined}
            onClick={() => {
              openPrompt();
              onClose();
            }}
          />
        </>
      ) : supportAction.kind === "operator" ? (
        <PopoverMenuItem
          variant="sidebar"
          label="Contact support"
          icon={<Mail className="icon-paired" />}
          onClick={() => {
            openExternalUrl(supportAction.url);
            onClose();
          }}
        />
      ) : null}
      <PopoverMenuItem
        variant="sidebar"
        label="Documentation"
        icon={<BookOpen className="icon-paired" />}
        trailing={<ArrowUpRight className="icon-compact" />}
        onClick={() => {
          openExternalUrl(PROLIFERATE_DOCS_URL);
          onClose();
        }}
      />
      <PopoverMenuItem
        variant="sidebar"
        label="Discord"
        icon={<Discord className="icon-paired" />}
        trailing={<ArrowUpRight className="icon-compact" />}
        onClick={() => {
          openExternalUrl(PROLIFERATE_DISCORD_URL);
          onClose();
        }}
      />
      <PopoverMenuItem
        variant="sidebar"
        label="Changelog"
        icon={<BookMarked className="icon-paired" />}
        trailing={<ArrowUpRight className="icon-compact" />}
        onClick={() => {
          openExternalUrl(PROLIFERATE_CHANGELOG_URL);
          onClose();
        }}
      />
      {webApp.available && webApp.baseUrl ? (
        <PopoverMenuItem
          variant="sidebar"
          label="Go to web"
          icon={<Globe className="icon-paired [font-size:var(--text-sidebar-row)]" />}
          trailing={<span>{getShortcutDisplayLabel(SHORTCUTS.openWebApp)}</span>}
          onClick={() => {
            openExternalUrl(webApp.baseUrl!);
            onClose();
          }}
        />
      ) : null}
    </div>
  );
}
