import { useEffect, useMemo, useState } from "react";
import { AnyHarnessRuntime, AnyHarnessWorkspace } from "@anyharness/sdk-react";
import { CloudClientProvider } from "@proliferate/cloud-sdk-react";
import { ProductHostProvider, useProductHost } from "@proliferate/product-client/host/ProductHostProvider";
import { Button } from "@proliferate/ui/primitives/Button";
import { SegmentedControl } from "@proliferate/ui/primitives/SegmentedControl";
import { QueryClientProvider } from "@tanstack/react-query";
import { Cloud, Laptop } from "lucide-react";
import { ApiKeysPane } from "#product/components/settings/panes/agents/api-keys/ApiKeysPane";
import { HarnessPane } from "#product/components/settings/panes/agents/harness/HarnessPane";
import {
  PLAYGROUND_CACHE_SCOPE,
  PLAYGROUND_RUNTIME_URL,
  buildMockQueryClient,
} from "#product/pages/agents-playground/agents-playground-fixtures";
import {
  AGENTS_PLAYGROUND_SCENARIOS,
  type AgentsPlaygroundScenario,
  type AgentsPlaygroundScenarioId,
} from "#product/pages/agents-playground/agents-playground-scenarios";
import { buildPlaygroundHost } from "#product/pages/agents-playground/agents-playground-cloud-client";
import { useAgentSurfaceStore } from "#product/stores/ui/agent-surface-store";

export function AgentsPlaygroundPage() {
  const parentHost = useProductHost();
  const [activeScenario, setActiveScenario] = useState<AgentsPlaygroundScenarioId>("ready-local");
  const surface = useAgentSurfaceStore((state) => state.surface);
  const setSurface = useAgentSurfaceStore((state) => state.setSurface);
  const scenario = AGENTS_PLAYGROUND_SCENARIOS.find(
    (candidate) => candidate.id === activeScenario,
  ) ?? AGENTS_PLAYGROUND_SCENARIOS[0];
  const { client, fixture, cloudTransport, runtimeTransport } = useMemo(
    () => buildMockQueryClient(parentHost, scenario),
    [parentHost, scenario],
  );
  const playgroundHost = useMemo(
    () => buildPlaygroundHost(parentHost, fixture.authenticated, cloudTransport.client),
    [cloudTransport.client, fixture.authenticated, parentHost],
  );

  useEffect(() => {
    setSurface(scenario.surface);
  }, [scenario.surface, setSurface]);

  function handleScenarioChange(nextScenario: AgentsPlaygroundScenario) {
    setSurface(nextScenario.surface);
    setActiveScenario(nextScenario.id);
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-2 border-b border-border bg-accent/50 px-4 py-2">
        <span className="text-xs font-medium text-muted-foreground">Scenario:</span>
        <div className="flex flex-1 flex-wrap gap-1">
          {AGENTS_PLAYGROUND_SCENARIOS.map((candidate) => (
            <Button
              key={candidate.id}
              variant="unstyled"
              size="unstyled"
              type="button"
              className={[
                "rounded-md px-2.5 py-1 text-xs transition-colors",
                candidate.id === activeScenario
                  ? "bg-foreground/10 font-medium text-foreground"
                  : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
              ].join(" ")}
              onClick={() => handleScenarioChange(candidate)}
            >
              {candidate.label}
            </Button>
          ))}
        </div>
        <SegmentedControl
          ariaLabel="Agent authentication surface"
          value={surface}
          items={[
            { id: "cloud", label: "Cloud", icon: <Cloud /> },
            { id: "local", label: "Local", icon: <Laptop /> },
          ]}
          onChange={setSurface}
        />
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl">
          <QueryClientProvider client={client}>
            <CloudClientProvider client={cloudTransport.client} syncGlobalClient={false}>
              <ProductHostProvider host={playgroundHost}>
                <AnyHarnessRuntime
                  runtimeUrl={PLAYGROUND_RUNTIME_URL}
                  cacheScopeKey={PLAYGROUND_CACHE_SCOPE}
                  fetch={runtimeTransport.fetch}
                >
                  <AnyHarnessWorkspace
                    workspaceId={null}
                    resolveConnection={() => Promise.reject(
                      new Error("No playground workspace selected."),
                    )}
                  >
                    {scenario.pane === "harness" ? (
                      <HarnessPane key={activeScenario} harnessKind={scenario.harnessKind} />
                    ) : (
                      <ApiKeysPane key={activeScenario} />
                    )}
                  </AnyHarnessWorkspace>
                </AnyHarnessRuntime>
              </ProductHostProvider>
            </CloudClientProvider>
          </QueryClientProvider>
        </div>
      </main>

      <footer className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
        <code className="font-mono">Agents Settings Mockbed</code>
        <span className="mx-2">·</span>
        Deterministic query/provider fixtures
        <span className="mx-2">·</span>
        {activeScenario} / {scenario.harnessKind}
      </footer>
    </div>
  );
}
