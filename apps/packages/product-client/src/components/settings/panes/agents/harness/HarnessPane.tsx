import type { AgentSummary } from "@anyharness/sdk";
import type { AgentAuthSurface } from "@proliferate/cloud-sdk";
import { SettingsSection } from "#product/primitives/patterns/settings/SettingsSection";
import { SettingsRow } from "#product/primitives/patterns/settings/SettingsRow";
import { Badge } from "#product/primitives/Badge";
import { Button } from "#product/primitives/Button";
import { IconTile } from "#product/primitives/IconTile";
import { ArrowUpRight } from "#product/primitives/icons/core";
import { ProviderIcon } from "#product/primitives/icons/provider-icons";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { CloudGuard } from "#product/components/cloud/CloudGuard";
import { useAgentCatalog } from "#product/hooks/agents/derived/use-agent-catalog";
import { getProviderDisplayName } from "#product/lib/domain/agents/provider-display";
import { useAgentSurfaceStore } from "#product/stores/ui/agent-surface-store";
import { HARNESS_PANE_COPY } from "#product/copy/settings/harness-pane";
import { isMultiSourceHarness } from "#product/lib/domain/settings/harness-auth-sources";
import { HarnessAllModelsSection } from "#product/components/settings/panes/agents/harness/HarnessAllModelsSection";
import { ApiKeyDetails } from "#product/components/settings/panes/agents/harness/HarnessAuthApiKeyDetails";
import { CliDetails } from "#product/components/settings/panes/agents/harness/HarnessAuthCliDetails";
import { SeatDetails } from "#product/components/settings/panes/agents/harness/HarnessAuthSeatDetails";
import {
  HarnessAuthSection,
  deriveSelectedMethod,
} from "#product/components/settings/panes/agents/harness/HarnessAuthSection";
import { HarnessProvidersSection } from "#product/components/settings/panes/agents/harness/HarnessProvidersSection";
import { HarnessConfigIssueBanner } from "#product/components/settings/panes/agents/harness/HarnessConfigIssueBanner";
import { HarnessNativeBridgePrompt } from "#product/components/settings/panes/agents/harness/HarnessNativeBridgePrompt";
import { HarnessManagedNotice } from "#product/components/settings/panes/agents/harness/HarnessManagedNotice";
import { useHarnessAuthEditor } from "#product/hooks/agents/workflows/use-harness-auth-editor";
import { useHarnessInstallAction } from "#product/hooks/agents/workflows/use-harness-install-action";
import { getAgentStatusDisplay } from "#product/lib/domain/agents/status-presentation";
import { HarnessInstallGate } from "#product/components/settings/panes/agents/harness/HarnessInstallGate";
import { CloudAnyHarnessRuntimeProvider } from "#product/providers/CloudAnyHarnessRuntimeProvider";
import { SettingsPageBody } from "#product/primitives/patterns/settings/SettingsPageBody";

interface HarnessPaneProps {
  harnessKind: string;
}

const SETTINGS_HARNESS_DISPLAY_NAMES: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  grok: "Grok",
  opencode: "OpenCode",
};

/**
 * §1 — Title and docs. Harness display name, one-line description, and an exit
 * to the vendor's OWN documentation (`docsUrl`, declared per harness in the
 * runtime registry and projected onto `AgentSummary`). The first thing a user
 * needs from a vendor-tool pane is confirmation of which vendor tool it is.
 *
 * A harness whose registry entry declares no docsUrl simply renders no link —
 * the affordance is never faked with a guessed URL.
 */
function HarnessDocsLink({ docsUrl }: { docsUrl: string | null | undefined }) {
  const { links } = useProductHost();
  if (!docsUrl) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      className="gap-1.5"
      onClick={() => {
        void links.openExternal(docsUrl);
      }}
    >
      {HARNESS_PANE_COPY.docsLink}
      <ArrowUpRight className="icon-compact" />
    </Button>
  );
}

export function HarnessPane({ harnessKind }: HarnessPaneProps) {
  const surface = useAgentSurfaceStore((state) => state.surface);
  const displayName = SETTINGS_HARNESS_DISPLAY_NAMES[harnessKind]
    ?? getProviderDisplayName(harnessKind);
  const { agentsByKind } = useAgentCatalog();

  return (
    <SettingsPageBody>
      {/* §1 identity header (design-handoff v2): 42px provider glyph tile +
          name/vendor line + Docs exit. Inline rather than PageHeader's
          settings (flat) variant — that variant has no leading-tile slot, and
          this is a first-instance carve-out (no second call site exists to
          justify promoting a tile slot onto the shared pattern). */}
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3.5">
          <IconTile
            tone="outlined"
            size="lg"
            aria-hidden
            className="text-foreground"
          >
            <ProviderIcon
              kind={harnessKind}
              className="icon-large [font-size:var(--text-ui)]"
            />
          </IconTile>
          <div className="min-w-0">
            <h1 className="text-title font-semibold tracking-[-0.025em] text-foreground">
              {displayName}
            </h1>
            <p className="text-ui text-muted-foreground/55">
              {HARNESS_PANE_COPY.harnessIdentity[harnessKind]}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center">
          <HarnessDocsLink docsUrl={agentsByKind.get(harnessKind)?.docsUrl} />
        </div>
      </header>

      {surface === "cloud" ? (
        <CloudGuard>
          <CloudAnyHarnessRuntimeProvider>
            <HarnessRuntimeSurface harnessKind={harnessKind} surface="cloud" />
          </CloudAnyHarnessRuntimeProvider>
        </CloudGuard>
      ) : (
        <HarnessRuntimeSurface harnessKind={harnessKind} surface="local" />
      )}
    </SettingsPageBody>
  );
}

function HarnessRuntimeSurface({
  harnessKind,
  surface,
}: {
  harnessKind: string;
  surface: AgentAuthSurface;
}) {
  const runtimeCatalog = useAgentCatalog();
  const {
    agentsByKind,
    agentsNeedingSetup,
    isError: runtimeCatalogIsError,
    isLoading: runtimeCatalogIsLoading,
    isReconciling,
    reconcileSnapshot,
  } = runtimeCatalog;

  const runtimeAgent = agentsByKind.get(harnessKind);
  const displayName = runtimeAgent?.displayName ?? getProviderDisplayName(harnessKind);
  const issueAgent = agentsNeedingSetup.find((agent) => agent.kind === harnessKind);
  const installAction = useHarnessInstallAction(issueAgent ?? null);
  const updateComponents = isReconciling
    ? reconcileSnapshot?.progress?.components.filter(
      (component) => component.agent === harnessKind,
    ) ?? []
    : [];
  const showRuntimeStatus = runtimeCatalogIsLoading
    || runtimeCatalogIsError
    || !runtimeAgent
    || runtimeAgent.readiness !== "ready"
    || runtimeAgent.installState === "installing";

  if (updateComponents.length > 0 || installAction) {
    return (
      <HarnessInstallGate
        harnessKind={harnessKind}
        displayName={displayName}
        surface={surface}
        installAction={installAction}
        installing={updateComponents.length > 0}
      />
    );
  }

  return (
    <>
      {showRuntimeStatus ? (
        <SettingsSection
          title={HARNESS_PANE_COPY.runtimeTitle}
          description={HARNESS_PANE_COPY.runtimeDescription(surface)}
        >
          {issueAgent ? (
            <HarnessConfigIssueBanner agent={issueAgent} />
          ) : (
            <HarnessRuntimeStatusRow
              harnessKind={harnessKind}
              displayName={displayName}
              agent={runtimeAgent}
              surface={surface}
              loading={runtimeCatalogIsLoading}
              error={runtimeCatalogIsError}
            />
          )}
        </SettingsSection>
      ) : null}

      <HarnessManagedNotice
        harnessKind={harnessKind}
        displayName={displayName}
        agent={runtimeAgent}
      />

      {/* The native-migration bridge's one-time prompt (local machine truth;
          the cloud surface has no bridge). Sits directly above Authentication
          because acting on it IS picking a method there. */}
      {surface === "local" ? (
        <HarnessNativeBridgePrompt
          harnessKind={harnessKind}
          displayName={displayName}
        />
      ) : null}

      <HarnessAuthSurface
        harnessKind={harnessKind}
        displayName={displayName}
        surface={surface}
      />
    </>
  );
}

function HarnessRuntimeStatusRow({
  harnessKind,
  displayName,
  agent,
  surface,
  loading,
  error,
}: {
  harnessKind: string;
  displayName: string;
  agent: AgentSummary | undefined;
  surface: AgentAuthSurface;
  loading: boolean;
  error: boolean;
}) {
  const status = agent ? getAgentStatusDisplay(agent) : null;
  const tone = status?.tone === "success"
    ? "success"
    : status?.tone === "warning"
      ? "warning"
      : status?.tone === "destructive"
        ? "destructive"
        : "neutral";
  const label = loading
    ? HARNESS_PANE_COPY.runtimeChecking
    : error
      ? HARNESS_PANE_COPY.runtimeUnavailable
      : status?.label ?? HARNESS_PANE_COPY.runtimeNotReported;
  const description = loading
    ? HARNESS_PANE_COPY.runtimeCheckingDescription(surface)
    : error
      ? HARNESS_PANE_COPY.runtimeUnavailableDescription(surface)
      : !agent
        ? HARNESS_PANE_COPY.runtimeNotReportedDescription(surface)
        : agent.readiness === "ready" && agent.installState !== "installing"
          ? HARNESS_PANE_COPY.runtimeReadyDescription(surface)
          : agent.readiness === "unsupported"
            ? HARNESS_PANE_COPY.runtimeUnsupportedDescription(surface)
            : HARNESS_PANE_COPY.runtimeStatusDescription(label, surface);

  return (
    <SettingsRow
      data-harness-runtime-state={loading ? "loading" : error ? "error" : agent?.readiness ?? "missing"}
      label={(
        <span className="flex min-w-0 items-center gap-2.5">
          {/* 28→32px on adoption: IconTile's size axis has no 28px step, and
              rounding a stray one-off to the nearest step is the tile's stated
              contract. PlanHandoffDialog took the same 4px growth in this
              wave; the two should be ruled together. */}
          <IconTile>
            <ProviderIcon kind={harnessKind} className="icon-control" />
          </IconTile>
          <span className="truncate">{displayName}</span>
        </span>
      )}
      description={description}
    >
      <Badge tone={tone}>{label}</Badge>
    </SettingsRow>
  );
}

/**
 * The v2 pane anatomy (design-handoff v2): identity → Authentication
 * (method cards with the ONE status badge merged into the header, detail area
 * below the cards) → harness settings → Models. There is no separate Status
 * section — the state is said exactly once, in the section header. OpenCode
 * replaces Authentication with a providers-only section (no chooser, no
 * gateway).
 */
function HarnessAuthSurface({
  harnessKind,
  displayName,
  surface,
}: {
  harnessKind: string;
  displayName: string;
  surface: AgentAuthSurface;
}) {
  const editor = useHarnessAuthEditor(harnessKind, displayName, surface);
  const selectedMethod = deriveSelectedMethod(editor);
  const multiSource = isMultiSourceHarness(harnessKind);

  return (
    <>
      {multiSource ? (
        <HarnessProvidersSection editor={editor} />
      ) : (
        <HarnessAuthSection
          harnessKind={harnessKind}
          displayName={displayName}
          surface={surface}
          editor={editor}
        >
          {/* Method detail area, below the cards. Gateway needs no detail —
              failure shows on the disabled card + header badge. */}
          {selectedMethod === "api_key" ? (
            <ApiKeyDetails harnessKind={harnessKind} editor={editor} />
          ) : selectedMethod === "seat" ? (
            <SeatDetails editor={editor} surface={surface} />
          ) : selectedMethod === "cli" ? (
            <CliDetails editor={editor} />
          ) : null}
        </HarnessAuthSection>
      )}

      {/* Harness-specific options, AFTER auth: these are options on top of
          a working harness, so they sit below the thing that makes it work. */}

      {/* Model list, auto-collapsed. */}
      <HarnessAllModelsSection
        harnessKind={harnessKind}
        displayName={displayName}
        surface={surface}
      />
    </>
  );
}
