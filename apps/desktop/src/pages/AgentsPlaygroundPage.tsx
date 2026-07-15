import { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Cloud, Laptop } from "lucide-react";
import { SegmentedControl } from "@proliferate/ui/primitives/SegmentedControl";
import { Button } from "@proliferate/ui/primitives/Button";
import { HarnessPane } from "@/components/settings/panes/agents/harness/HarnessPane";
import { useAgentSurfaceStore } from "@/stores/ui/agent-surface-store";

type ScenarioId =
  | "claude-unconfigured"
  | "claude-gateway-active"
  | "claude-cli-expired"
  | "opencode-multi-source"
  | "empty-mid-probe"
  | "cloud-gated";

interface Scenario {
  id: ScenarioId;
  label: string;
  harnessKind: string;
}

const SCENARIOS: readonly Scenario[] = [
  { id: "claude-unconfigured", label: "Claude unconfigured", harnessKind: "claude" },
  { id: "claude-gateway-active", label: "Claude gateway active", harnessKind: "claude" },
  { id: "claude-cli-expired", label: "Claude CLI expired", harnessKind: "claude" },
  { id: "opencode-multi-source", label: "OpenCode multi-source", harnessKind: "opencode" },
  { id: "empty-mid-probe", label: "Empty catalog (Probing...)", harnessKind: "claude" },
  { id: "cloud-gated", label: "Cloud gated (signed out)", harnessKind: "claude" },
];

// Fixture data builders for each scenario.
function buildFixtureState(scenario: ScenarioId) {
  const base = {
    cloudActive: true,
    capabilities: { gatewayEnabled: true, publicBaseUrl: "https://gateway.proliferate.dev", enrollmentStatus: "synced" },
    enrollment: undefined as { syncStatus: string; lastErrorCode: string | null } | undefined,
    selections: [] as Array<Record<string, unknown>>,
    apiKeys: [] as Array<Record<string, unknown>>,
    agentsByKind: new Map<string, { kind: string; displayName: string; readiness: string; supportsLogin: boolean }>(),
    catalogModels: [] as Array<Record<string, unknown>>,
    catalogSource: null as string | null,
    catalogProbedAt: null as string | null,
    gatewayModels: undefined as { models: Array<Record<string, unknown>>; source: string; probedAt?: string } | undefined,
    launchOptions: undefined as { agents: Array<{ kind: string; displayName: string; defaultModelId: string | null; models: Array<{ id: string; displayName: string; isDefault: boolean }> }> } | undefined,
  };

  switch (scenario) {
    case "claude-unconfigured":
      base.agentsByKind.set("claude", { kind: "claude", displayName: "Claude Code", readiness: "ready", supportsLogin: true });
      break;

    case "claude-gateway-active":
      base.agentsByKind.set("claude", { kind: "claude", displayName: "Claude Code", readiness: "ready", supportsLogin: true });
      base.selections = [{
        id: "sel-gw", harnessKind: "claude", surface: "local", sourceKind: "gateway",
        apiKeyId: null, keyTitle: null, envVarName: null, providerHint: null, enabled: true,
        createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z",
      }];
      base.gatewayModels = {
        models: [
          { id: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6", provider: "anthropic" },
          { id: "claude-opus-4-6", displayName: "Claude Opus 4.6", provider: "anthropic" },
          { id: "claude-haiku-4-5", displayName: "Claude Haiku 4.5", provider: "anthropic" },
          { id: "gpt-4o", displayName: "GPT-4o", provider: "openai" },
          { id: "gpt-4o-mini", displayName: "GPT-4o Mini", provider: "openai" },
          { id: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro", provider: "google" },
          { id: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash", provider: "google" },
          { id: "llama-4-maverick", displayName: "Llama 4 Maverick", provider: "meta" },
          { id: "deepseek-v4", displayName: "DeepSeek V4", provider: "deepseek" },
          { id: "mistral-large-2", displayName: "Mistral Large 2", provider: "mistral" },
          { id: "amazon.nova-pro-v1", displayName: "Amazon Nova Pro", provider: "aws-bedrock" },
          { id: "amazon.nova-lite-v1", displayName: "Amazon Nova Lite", provider: "aws-bedrock" },
          { id: "cohere.command-r-plus-v2", displayName: "Command R+", provider: "cohere" },
          { id: "anthropic.claude-sonnet-4-6-v1", displayName: "Claude Sonnet 4.6 (Bedrock)", provider: "aws-bedrock" },
          { id: "anthropic.claude-opus-4-6-v1", displayName: "Claude Opus 4.6 (Bedrock)", provider: "aws-bedrock" },
          { id: "us.anthropic.claude-sonnet-4-6-v1", displayName: "Claude Sonnet 4.6 (Bedrock US)", provider: "aws-bedrock" },
          { id: "meta.llama4-maverick-17b-instruct-v1", displayName: "Llama 4 Maverick (Bedrock)", provider: "aws-bedrock" },
          { id: "mistral.mistral-large-2-v1", displayName: "Mistral Large 2 (Bedrock)", provider: "aws-bedrock" },
          { id: "qwen-2.5-coder-32b", displayName: "Qwen 2.5 Coder 32B", provider: "alibaba" },
          { id: "yi-large", displayName: "Yi Large", provider: "01.ai" },
        ],
        source: "probe",
        probedAt: "2026-07-06T14:30:00Z",
      };
      break;

    case "claude-cli-expired":
      base.agentsByKind.set("claude", { kind: "claude", displayName: "Claude Code", readiness: "login_required", supportsLogin: true });
      break;

    case "opencode-multi-source":
      base.agentsByKind.set("opencode", { kind: "opencode", displayName: "OpenCode", readiness: "ready", supportsLogin: false });
      base.selections = [
        {
          id: "sel-gw", harnessKind: "opencode", surface: "local", sourceKind: "gateway",
          apiKeyId: null, keyTitle: null, envVarName: null, providerHint: null, enabled: true,
          createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z",
        },
        {
          id: "sel-key", harnessKind: "opencode", surface: "local", sourceKind: "api_key",
          apiKeyId: "key-1", keyTitle: "OpenRouter prod", envVarName: "OPENROUTER_API_KEY",
          providerHint: "openrouter", enabled: true,
          createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-01T00:00:00Z",
        },
      ];
      base.apiKeys = [
        { id: "key-1", title: "OpenRouter prod", redactedHint: "sk-or-...x9f2", status: "active", createdAt: "2026-07-01T00:00:00Z" },
        { id: "key-2", title: "Anthropic personal", redactedHint: "sk-ant-...b3e1", status: "active", createdAt: "2026-06-15T00:00:00Z" },
      ];
      base.catalogModels = [
        { id: "opencode/glm-5", displayName: "GLM-5", provider: "zhipu" },
        { id: "opencode-go/deepseek-v4-pro", displayName: "DeepSeek V4 Pro", provider: "deepseek" },
        { id: "kimi/moonshot-v2", displayName: "Kimi Moonshot V2", provider: "moonshot" },
        { id: "qwen/qwen-3-235b", displayName: "Qwen 3 235B", provider: "alibaba" },
        { id: "openrouter/claude-sonnet-4-6", displayName: "Claude Sonnet 4.6", provider: "openrouter" },
        { id: "openrouter/gpt-4o", displayName: "GPT-4o", provider: "openrouter" },
        { id: "native/opencode-go-deepseek", displayName: "DeepSeek (native)", provider: "deepseek" },
        { id: "native/opencode-go-qwen", displayName: "Qwen (native)", provider: "alibaba" },
      ];
      base.catalogSource = "probe";
      base.catalogProbedAt = "2026-07-06T10:00:00Z";
      break;

    case "empty-mid-probe":
      base.agentsByKind.set("claude", { kind: "claude", displayName: "Claude Code", readiness: "ready", supportsLogin: true });
      // Empty catalog + refreshing = shows "Probing..." state
      break;

    case "cloud-gated":
      base.cloudActive = false;
      break;
  }

  return base;
}

// Per-scenario mock QueryClient that returns fixture data for all the hooks
// the HarnessPane tree uses. We intercept at the react-query level, matching
// the query keys used by cloud-sdk-react and anyharness/sdk-react hooks.
function buildMockQueryClient(scenario: ScenarioId): QueryClient {
  const fixtures = buildFixtureState(scenario);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });

  // Seed query data directly so hooks see it immediately.
  // cloud-sdk-react hooks use string-array keys per their implementation.
  client.setQueryData(["agent-gateway-capabilities"], fixtures.capabilities);
  client.setQueryData(["agent-gateway-enrollment"], undefined);
  client.setQueryData(["auth-selections", null], fixtures.selections);
  client.setQueryData(["agent-api-keys"], fixtures.apiKeys);
  if (fixtures.gatewayModels) {
    client.setQueryData(["agent-gateway-models", fixtures.gatewayModels], fixtures.gatewayModels);
  }

  return client;
}

// Mocking strategy: we provide a QueryClientProvider with pre-seeded data.
// For hooks that read from stores or non-react-query sources (useAgentCatalog,
// useCloudAvailabilityState, useHarnessConnectionStore), we'd normally need
// module-level mocks. In the playground we render HarnessPane directly; the
// hooks will fall through to the real providers/stores. For the playground to
// work without a backend, the QueryClient seeding handles the critical path
// (selections, capabilities, api keys). Hooks reading from Zustand stores
// (useCloudAvailabilityState, useAgentCatalog) return their defaults which is
// acceptable for visual iteration. In a true dev environment with a running
// runtime, these would be populated.

export function AgentsPlaygroundPage() {
  const [activeScenario, setActiveScenario] = useState<ScenarioId>("claude-unconfigured");
  const [queryClient, setQueryClient] = useState(() => buildMockQueryClient(activeScenario));
  const surface = useAgentSurfaceStore((state) => state.surface);
  const setSurface = useAgentSurfaceStore((state) => state.setSurface);

  // Reset surface to local on mount for predictable playground state
  useEffect(() => {
    setSurface("local");
  }, [setSurface]);

  function handleScenarioChange(id: ScenarioId) {
    setActiveScenario(id);
    setQueryClient(buildMockQueryClient(id));
  }

  const scenario = SCENARIOS.find((s) => s.id === activeScenario)!;

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Scenario switcher bar */}
      <header className="flex items-center gap-2 border-b border-border bg-accent/50 px-4 py-2">
        <span className="text-xs font-medium text-muted-foreground">Scenario:</span>
        <div className="flex flex-wrap gap-1">
          {SCENARIOS.map((s) => (
            <Button
              key={s.id}
              variant="unstyled"
              size="unstyled"
              type="button"
              className={[
                "rounded-md px-2.5 py-1 text-xs transition-colors",
                s.id === activeScenario
                  ? "bg-foreground/10 font-medium text-foreground"
                  : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
              ].join(" ")}
              onClick={() => handleScenarioChange(s.id)}
            >
              {s.label}
            </Button>
          ))}
        </div>
        <div className="ml-auto">
          <SegmentedControl
            ariaLabel="Agent authentication surface"
            value={surface}
            items={[
              { id: "cloud", label: "Cloud", icon: <Cloud /> },
              { id: "local", label: "Local", icon: <Laptop /> },
            ]}
            onChange={setSurface}
          />
        </div>
      </header>

      {/* Main content: HarnessPane rendered with mock data */}
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl">
          <QueryClientProvider client={queryClient}>
            <HarnessPane harnessKind={scenario.harnessKind} />
          </QueryClientProvider>
        </div>
      </main>

      <footer className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
        <code className="font-mono">Agents Settings Mockbed</code>
        <span className="mx-2">·</span>
        Dev only · import.meta.env.DEV
        <span className="mx-2">·</span>
        Scenario: {activeScenario} / harness: {scenario.harnessKind}
      </footer>
    </div>
  );
}
