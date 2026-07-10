import {
  BookMarked,
  BookOpen,
  Globe,
  Keyboard,
  Lightbulb,
  MessageSquare,
} from "lucide-react";
import { ArrowUpRight, Discord, Mail } from "@proliferate/ui/icons";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import { PROLIFERATE_DOCS_URL } from "@/config/capabilities";
import { SHORTCUTS } from "@/config/shortcuts/registry";
import type { WebAppTarget } from "@/hooks/capabilities/derived/use-web-app-target";
import type { SupportMenuAction } from "@/lib/domain/support/support-menu-action";
import { getShortcutDisplayLabel } from "@/lib/domain/shortcuts/matching";

const PROLIFERATE_CHANGELOG_URL = "https://proliferate.com/changelog";
const PROLIFERATE_DISCORD_URL = "https://discord.gg/7b5afMTqW";

export interface SidebarHelpSectionProps {
  webApp: WebAppTarget;
  supportAction: SupportMenuAction;
  supportDisabledReason: string | null;
  openSupport: () => void;
  openPrompt: () => void;
  openExternalUrl: (url: string) => void;
  onShowKeyboardShortcuts: () => void;
  onClose: () => void;
}

/**
 * Docs/Changelog/Discord/keyboard-shortcuts (always universal — no gating) plus
 * the capability-gated "Go to web" and support actions:
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
  onShowKeyboardShortcuts,
  onClose,
}: SidebarHelpSectionProps) {
  return (
    <div className="border-t border-border-light py-1">
      <PopoverMenuItem
        variant="sidebar"
        label="Keyboard shortcuts"
        icon={<Keyboard className="size-4" />}
        trailing={<span>{getShortcutDisplayLabel(SHORTCUTS.showKeyboardShortcuts)}</span>}
        onClick={() => {
          onClose();
          onShowKeyboardShortcuts();
        }}
      />
      <PopoverMenuItem
        variant="sidebar"
        label="Docs"
        icon={<BookOpen className="size-4" />}
        trailing={<ArrowUpRight className="size-3" />}
        onClick={() => {
          openExternalUrl(PROLIFERATE_DOCS_URL);
          onClose();
        }}
      />
      <PopoverMenuItem
        variant="sidebar"
        label="Changelog"
        icon={<BookMarked className="size-4" />}
        trailing={<ArrowUpRight className="size-3" />}
        onClick={() => {
          openExternalUrl(PROLIFERATE_CHANGELOG_URL);
          onClose();
        }}
      />
      <PopoverMenuItem
        variant="sidebar"
        label="Discord"
        icon={<Discord className="size-4" />}
        trailing={<ArrowUpRight className="size-3" />}
        onClick={() => {
          openExternalUrl(PROLIFERATE_DISCORD_URL);
          onClose();
        }}
      />
      {webApp.available && webApp.baseUrl ? (
        <PopoverMenuItem
          variant="sidebar"
          label="Go to web"
          icon={<Globe className="size-4" />}
          trailing={<span>{getShortcutDisplayLabel(SHORTCUTS.openWebApp)}</span>}
          onClick={() => {
            openExternalUrl(webApp.baseUrl!);
            onClose();
          }}
        />
      ) : null}
      {supportAction.kind === "vendor" ? (
        <>
          <PopoverMenuItem
            variant="sidebar"
            label="Send feedback"
            icon={<MessageSquare className="size-4" />}
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
            icon={<Lightbulb className="size-4" />}
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
          icon={<Mail className="size-4" />}
          onClick={() => {
            openExternalUrl(supportAction.url);
            onClose();
          }}
        />
      ) : null}
    </div>
  );
}
