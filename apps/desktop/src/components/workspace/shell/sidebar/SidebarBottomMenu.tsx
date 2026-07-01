import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BookOpen,
  Globe,
  Keyboard,
  LogOut,
  MessageSquare,
  Settings,
} from "lucide-react";
import { ArrowUpRight } from "@proliferate/ui/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@proliferate/ui/kit/DropdownMenu";
import { Button } from "@proliferate/ui/primitives/Button";
import { Tooltip } from "@proliferate/ui/primitives/Tooltip";
import { KeyboardShortcutsDialog } from "./KeyboardShortcutsDialog";
import { SidebarUpdatePill } from "./SidebarUpdatePill";
import { PROLIFERATE_DOCS_URL } from "@/config/capabilities";
import { SHORTCUTS } from "@/config/shortcuts/registry";
import { useAgentCatalog } from "@/hooks/agents/derived/use-agent-catalog";
import { useAppSidebarSignOutAction } from "@/hooks/app/workflows/use-app-sidebar-sign-out-action";
import { useAppVersion } from "@/hooks/access/tauri/app/use-app-version";
import { useCloudBilling } from "@/hooks/cloud/facade/use-cloud-billing";
import { useUpdater } from "@/hooks/access/tauri/use-updater";
import { useOpenSupportReportWindow } from "@/hooks/support/workflows/use-open-support-report-window";
import { useTauriShellActions } from "@/hooks/access/tauri/use-shell-actions";
import { getProliferateWebBaseUrl } from "@/lib/infra/proliferate-web";
import { getShortcutDisplayLabel } from "@/lib/domain/shortcuts/matching";
import { useAuthStore } from "@/stores/auth/auth-store";
import { useToastStore } from "@/stores/toast/toast-store";

const PROLIFERATE_CHANGELOG_URL = "https://proliferate.com/changelog";
const PROLIFERATE_DISCORD_URL = "https://discord.gg/wCEgUnEuF";

/**
 * Sidebar bottom block (UX spec §2.5 + §9): hairline divider, codex-style
 * account row (avatar 28px + name 13px + plan 12px faint) that opens the
 * Conductor-derived settings popover — Keyboard shortcuts / Docs (Changelog,
 * Discord indented) / Go to web / Send feedback / Settings / Log out, with a
 * harness-versions footer line.
 */
export function SidebarBottomMenu() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const { openExternal } = useTauriShellActions();
  const handleSignOut = useAppSidebarSignOutAction();
  const openSupport = useOpenSupportReportWindow({ source: "sidebar" });
  const showToast = useToastStore((state) => state.show);
  const { data: billingPlan } = useCloudBilling();
  const {
    phase: updaterPhase,
    downloadUpdate,
    openRestartPrompt,
  } = useUpdater();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const displayName = user?.display_name?.trim() || user?.email || "Account";
  const initials = displayName.trim().slice(0, 2).toUpperCase() || "PR";
  const planLabel = billingPlan
    ? (billingPlan.isPaidCloud ? "Pro" : "Free")
    : null;

  const openExternalUrl = (url: string) => {
    void openExternal(url).catch(() => {
      showToast("Failed to open the link.");
    });
  };

  return (
    <div className="shrink-0">
      <div aria-hidden className="h-[0.5px] bg-border" />
      <div className="flex items-center px-2 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="unstyled"
              size="unstyled"
              aria-label="Open settings"
              className="flex h-10 w-full min-w-0 items-center gap-3 rounded-[10px] px-2 text-left text-sidebar-foreground hover:bg-sidebar-accent data-[state=open]:bg-sidebar-accent"
            >
              <span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-sidebar-accent text-xs font-medium text-sidebar-foreground">
                {user?.avatar_url ? (
                  <img
                    src={user.avatar_url}
                    alt=""
                    className="size-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  initials
                )}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px] leading-5">{displayName}</span>
                {planLabel ? (
                  <span className="truncate text-[12px] leading-4 text-faint">{planLabel}</span>
                ) : null}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <div className="ml-1 flex shrink-0 items-center empty:hidden">
            <SidebarUpdatePill
              phase={updaterPhase}
              onDownloadUpdate={downloadUpdate}
              onOpenRestartPrompt={openRestartPrompt}
            />
          </div>
          <DropdownMenuContent
            side="top"
            align="start"
            sideOffset={8}
            className="w-[340px]"
          >
            <DropdownMenuItem onSelect={() => setShortcutsOpen(true)}>
              <Keyboard className="size-4 text-muted-foreground" />
              Keyboard shortcuts
              <DropdownMenuShortcut>
                {getShortcutDisplayLabel(SHORTCUTS.showKeyboardShortcuts)}
              </DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openExternalUrl(PROLIFERATE_DOCS_URL)}>
              <BookOpen className="size-4 text-muted-foreground" />
              Docs
              <ArrowUpRight className="size-3 text-muted-foreground" />
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openExternalUrl(PROLIFERATE_CHANGELOG_URL)}>
              <span className="ml-6">Changelog</span>
              <ArrowUpRight className="size-3 text-muted-foreground" />
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openExternalUrl(PROLIFERATE_DISCORD_URL)}>
              <span className="ml-6">Discord</span>
              <ArrowUpRight className="size-3 text-muted-foreground" />
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openExternalUrl(getProliferateWebBaseUrl())}>
              <Globe className="size-4 text-muted-foreground" />
              Go to web
              <DropdownMenuShortcut>
                {getShortcutDisplayLabel(SHORTCUTS.openWebApp)}
              </DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => openSupport()}>
              <MessageSquare className="size-4 text-muted-foreground" />
              Send feedback
              <DropdownMenuShortcut>
                {getShortcutDisplayLabel(SHORTCUTS.openSupport)}
              </DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate("/settings")}>
              <Settings className="size-4 text-muted-foreground" />
              Settings
              <DropdownMenuShortcut>
                {getShortcutDisplayLabel(SHORTCUTS.openSettings)}
              </DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => handleSignOut()}>
              <LogOut className="size-4 text-muted-foreground" />
              Log out
            </DropdownMenuItem>
            <HarnessVersionsRow />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <KeyboardShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}

/**
 * §9 footer line: `Proliferate v{x} • Claude Code {y} • …` from installed
 * agent artifact versions (agentProcess.version via the agents query).
 * Truncated with a tooltip listing everything.
 */
function HarnessVersionsRow() {
  const { data: appVersion } = useAppVersion();
  const { agents } = useAgentCatalog();

  const versions = useMemo(() => {
    const parts: string[] = [`Proliferate v${appVersion ?? "…"}`];
    for (const agent of agents) {
      if (agent.installState !== "installed") {
        continue;
      }
      const version = agent.agentProcess?.version ?? agent.native?.version;
      if (version) {
        parts.push(`${agent.displayName} ${version}`);
      }
    }
    return parts;
  }, [agents, appVersion]);

  const line = versions.join(" • ");

  return (
    <div className="mt-1 border-t border-border px-2.5 pb-1 pt-2">
      <Tooltip content={line} className="block max-w-full">
        <div className="truncate text-[11px] leading-4 text-faint">{line}</div>
      </Tooltip>
    </div>
  );
}
