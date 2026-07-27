import type { AgentSummary } from "@anyharness/sdk";
import type { AgentAuthSurface } from "@proliferate/cloud-sdk";
import { SettingsPageHeader } from "@proliferate/product-ui/patterns/SettingsPageHeader";
import { SettingsSection } from "@proliferate/product-ui/patterns/SettingsSection";
import { SettingsRow } from "@proliferate/product-ui/patterns/SettingsRow";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { ArrowUpRight } from "@proliferate/ui/icons";
import { ProviderIcon } from "@proliferate/ui/icons/provider-icons";
import { useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { CloudGuard } from "#product/components/cloud/CloudGuard";
import { useAgentCatalog } from "#product/hooks/agents/derived/use-agent-catalog";
import { getProviderDisplayName } from "#product/lib/domain/agents/provider-display";
import { useAgentSurfaceStore } from "#product/stores/ui/agent-surface-store";
import { HARNESS_PANE_COPY } from "#product/copy/settings/harness-pane";
import { isMultiSourceHarness } from "#product/lib/domain/settings/harness-auth-sources";
import { HarnessAllModelsSection } from "#product/components/settings/panes/agents/harness/HarnessAllModelsSection";
import { HarnessAuthDetailsSection } from "#product/components/settings/panes/agents/harness/HarnessAuthDetailsSection";
import { ApiKeyDetails } from "#product/components/settings/panes/agents/harness/HarnessAuthApiKeyDetails";
import {
  HarnessAuthSection,
  deriveSelectedMethod,
  isMultiSourceApiKeyConfigVisible,
} from "#product/components/settings/panes/agents/harness/HarnessAuthSection";
import { HarnessConfigIssueBanner } from "#product/components/settings/panes/agents/harness/HarnessConfigIssueBanner";
import { HarnessSettingsSection } from "#product/components/settings/panes/agents/harness/HarnessSettingsSection";
import { useHarnessAuthEditor } from "#product/hooks/agents/workflows/use-harness-auth-editor";
import { useHarnessInstallAction } from "#product/hooks/agents/workflows/use-harness-install-action";
import { getAgentStatusDisplay } from "#product/lib/domain/agents/status-presentation";
import { HarnessInstallGate } from "#product/components/settings/panes/agents/harness/HarnessInstallGate";
import { CloudAnyHarnessRuntimeProvider } from "#product/providers/CloudAnyHarnessRuntimeProvider";

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
    <section className="space-y-6">
      <SettingsPageHeader
        title={displayName}
        description={HARNESS_PANE_COPY.surfaceDescription(surface, displayName)}
        action={<HarnessDocsLink docsUrl={agentsByKind.get(harnessKind)?.docsUrl} />}
      />

      {surface === "cloud" ? (
        <CloudGuard>
          <CloudAnyHarnessRuntimeProvider>
            <HarnessRuntimeSurface harnessKind={harnessKind} surface="cloud" />
          </CloudAnyHarnessRuntimeProvider>
        </CloudGuard>
      ) : (
        <HarnessRuntimeSurface harnessKind={harnessKind} surface="local" />
      )}
    </section>
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
  const installAction = useHarnessInstallAction(issueAgent ?? null, surface);
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
          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-control text-muted-foreground">
            <ProviderIcon kind={harnessKind} className="icon-control" />
          </span>
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
 * The seven-section anatomy (agent-auth.md "Pane anatomy"), one component for
 * both surfaces. The order is the ruling: identity → auth → whether that worked
 * → keys → provider add → options → models, so the pane reads top to bottom as
 * "which harness → how it authenticates → whether that worked → what else it
 * can do → what it can run".
 *
 * Everything here is a flat titled section separated by the rows' own hairlines.
 * There is no card, tile, or bordered box: a card implies a self-contained
 * object, and these sections are facets of one harness.
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
  // §4/§5 render whenever there is a key surface to show. For opencode this is
  // NOT gated on a §2 choice (§2 "for opencode this section is not a gate"):
  // its methods compose additively, so the key surface is reachable as soon as
  // any row exists or the user starts configuring one.
  const showKeys = multiSource
    ? isMultiSourceApiKeyConfigVisible(editor)
    : selectedMethod === "api_key";

  return (
    <>
      {/* §2 — Auth method (radio semantics, uncarded). */}
      <HarnessAuthSection
        harnessKind={harnessKind}
        displayName={displayName}
        surface={surface}
        editor={editor}
      />

      {/* §3 — Authenticated status, one row shape for every method. On the
          cloud surface this stays gated on authReady (cloud has no native CLI
          row to fall back to when auth isn't ready). On local it always
          renders: the native CLI status row + Authenticate affordance must be
          reachable for signed-out/local-only users too. */}
      {(surface === "cloud" ? editor.authReady : true) ? (
        <HarnessAuthDetailsSection
          harnessKind={harnessKind}
          selectedMethod={selectedMethod}
          editor={editor}
        />
      ) : null}

      {/* §4 + §5 — API keys and (opencode only) Add provider. */}
      {showKeys ? (
        <ApiKeyDetails harnessKind={harnessKind} editor={editor} />
      ) : null}

      {/* §6 — Harness-specific options, AFTER auth: these are options on top of
          a working harness, so they sit below the thing that makes it work. */}
      <HarnessSettingsSection harnessKind={harnessKind} surface={surface} />

      {/* §7 — Model list, auto-collapsed, same status row as §3. */}
      <HarnessAllModelsSection
        harnessKind={harnessKind}
        displayName={displayName}
        surface={surface}
      />
    </>
  );
}
