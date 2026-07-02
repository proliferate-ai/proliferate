// Mirrors AGENT_API_KEY_PROVIDERS on the server
// (server/proliferate/constants/agent_gateway.py).
export const AGENT_API_KEY_PROVIDERS = [
  { id: "anthropic", label: "Anthropic" },
  { id: "openai", label: "OpenAI" },
  { id: "xai", label: "xAI" },
  { id: "google", label: "Google" },
  { id: "other", label: "Other" },
] as const;

export type AgentApiKeyProviderId = (typeof AGENT_API_KEY_PROVIDERS)[number]["id"];

export function agentApiKeyProviderLabel(provider: string): string {
  const match = AGENT_API_KEY_PROVIDERS.find((entry) => entry.id === provider);
  return match?.label ?? provider;
}
