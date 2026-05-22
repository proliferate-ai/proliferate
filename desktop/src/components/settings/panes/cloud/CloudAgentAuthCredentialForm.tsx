import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import type {
  AgentAuthAgentKind,
  AgentGatewayCapabilities,
  CreateGatewayCredentialRequest,
} from "@proliferate/cloud-sdk";
import { useAgentAuthMutations } from "@proliferate/cloud-sdk-react/hooks/agent-auth";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@/components/ui/Label";
import { Select } from "@/components/ui/Select";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";

type ProviderChoice =
  | "anthropic_api_key"
  | "openai_api_key"
  | "bedrock_assume_role"
  | "openai_compatible";

interface OrganizationOption {
  id: string;
  name: string;
  membership?: {
    role?: "owner" | "admin" | "member";
  } | null;
}

interface CloudAgentAuthCredentialFormProps {
  organizations: OrganizationOption[];
  libraryOrganizationId: string | null;
  onLibraryOrganizationChange: (organizationId: string | null) => void;
  agentGatewayCapabilities: AgentGatewayCapabilities | null;
}

const PROVIDER_OPTIONS: { value: ProviderChoice; label: string }[] = [
  { value: "anthropic_api_key", label: "Anthropic API key" },
  { value: "openai_api_key", label: "OpenAI API key" },
  { value: "bedrock_assume_role", label: "AWS Bedrock role" },
  { value: "openai_compatible", label: "OpenAI-compatible provider" },
];

export function CloudAgentAuthCredentialForm({
  organizations,
  libraryOrganizationId,
  onLibraryOrganizationChange,
  agentGatewayCapabilities,
}: CloudAgentAuthCredentialFormProps) {
  const adminOrganizations = organizations.filter(isAdminOrganization);
  const firstAdminOrganizationId = adminOrganizations[0]?.id ?? null;
  const mutations = useAgentAuthMutations();
  const providerOptions = useMemo(
    () => providerOptionsForCapabilities(agentGatewayCapabilities),
    [agentGatewayCapabilities],
  );
  const gatewayByokEnabled = providerOptions.length > 0;
  const [providerKind, setProviderKind] = useState<ProviderChoice>("anthropic_api_key");
  const [agentKind, setAgentKind] = useState<Extract<AgentAuthAgentKind, "codex" | "opencode">>("codex");
  const [ownerScope, setOwnerScope] = useState<"personal" | "organization">("personal");
  const [displayName, setDisplayName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [roleArn, setRoleArn] = useState("");
  const [region, setRegion] = useState("us-east-1");
  const [externalId, setExternalId] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const libraryOrganizationCanOwnCredential = adminOrganizations.some(
    (organization) => organization.id === libraryOrganizationId,
  );
  const selectedOrganizationId = ownerScope === "organization"
    ? adminOrganizations.find((organization) => organization.id === libraryOrganizationId)?.id
      ?? null
    : null;
  const canCreate =
    displayName.trim().length > 0
    && (ownerScope === "personal" || Boolean(selectedOrganizationId))
    && createPayloadReady(providerKind, { apiKey, baseUrl, roleArn, region, externalId });

  useEffect(() => {
    if (providerOptions.length > 0 && !providerOptions.some((option) => option.value === providerKind)) {
      setProviderKind(providerOptions[0].value);
    }
  }, [providerKind, providerOptions]);

  useEffect(() => {
    if (
      agentKind === "opencode"
      && agentGatewayCapabilities?.opencodeGatewayEnabled !== true
    ) {
      setAgentKind("codex");
    }
  }, [agentGatewayCapabilities?.opencodeGatewayEnabled, agentKind]);

  async function handleCreateCredential() {
    const body = buildCreateCredentialRequest({
      providerKind,
      agentKind,
      ownerScope,
      organizationId: selectedOrganizationId,
      displayName,
      apiKey,
      baseUrl,
      roleArn,
      region,
      externalId,
    });
    setFeedback(null);
    try {
      const result = await mutations.createCredential(body);
      setDisplayName("");
      setApiKey("");
      setBaseUrl("");
      setRoleArn("");
      setExternalId("");
      setFeedback(`${result.credential.displayName} saved.`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not save credential.");
    }
  }

  return (
    <SettingsCard>
      <div className="space-y-3 p-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="agent-auth-library-scope">Library scope</Label>
            <Select
              id="agent-auth-library-scope"
              value={libraryOrganizationId ?? ""}
              onChange={(event) => onLibraryOrganizationChange(event.target.value || null)}
            >
              <option value="">Personal</option>
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </Select>
          </div>
          {gatewayByokEnabled && (
            <div>
              <Label htmlFor="agent-auth-owner-scope">New credential owner</Label>
              <Select
                id="agent-auth-owner-scope"
                value={ownerScope}
                onChange={(event) => {
                  const nextOwnerScope = event.target.value as typeof ownerScope;
                  setOwnerScope(nextOwnerScope);
                  if (
                    nextOwnerScope === "organization"
                    && !libraryOrganizationCanOwnCredential
                    && firstAdminOrganizationId
                  ) {
                    onLibraryOrganizationChange(firstAdminOrganizationId);
                  }
                }}
              >
                <option value="personal">Personal</option>
                <option value="organization" disabled={!firstAdminOrganizationId}>
                  Organization
                </option>
              </Select>
            </div>
          )}
        </div>

        {gatewayByokEnabled && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="agent-auth-provider-kind">Provider</Label>
                <Select
                  id="agent-auth-provider-kind"
                  value={providerKind}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    setProviderKind(event.target.value as ProviderChoice)}
                >
                  {providerOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </div>
              {(providerKind === "openai_api_key" || providerKind === "openai_compatible") && (
                <div>
                  <Label htmlFor="agent-auth-agent-kind">Agent</Label>
                  <Select
                    id="agent-auth-agent-kind"
                    value={agentKind}
                    onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                      setAgentKind(
                        event.target.value as Extract<AgentAuthAgentKind, "codex" | "opencode">,
                      )}
                  >
                    <option value="codex">Codex</option>
                    <option
                      value="opencode"
                      disabled={agentGatewayCapabilities?.opencodeGatewayEnabled !== true}
                    >
                      OpenCode
                    </option>
                  </Select>
                </div>
              )}
            </div>

            <div>
              <Label htmlFor="agent-auth-display-name">Display name</Label>
              <Input
                id="agent-auth-display-name"
                value={displayName}
                placeholder="Production Bedrock"
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  setDisplayName(event.target.value)}
              />
            </div>

            {(providerKind === "anthropic_api_key" || providerKind === "openai_api_key") && (
              <div>
                <Label htmlFor="agent-auth-api-key">API key</Label>
                <Input
                  id="agent-auth-api-key"
                  value={apiKey}
                  type="password"
                  placeholder="sk-..."
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setApiKey(event.target.value)}
                />
              </div>
            )}

            {providerKind === "openai_compatible" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="agent-auth-base-url">Base URL</Label>
                  <Input
                    id="agent-auth-base-url"
                    value={baseUrl}
                    placeholder="https://api.example.com/v1"
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setBaseUrl(event.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="agent-auth-compatible-api-key">API key</Label>
                  <Input
                    id="agent-auth-compatible-api-key"
                    value={apiKey}
                    type="password"
                    placeholder="sk-..."
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setApiKey(event.target.value)}
                  />
                </div>
              </div>
            )}

            {providerKind === "bedrock_assume_role" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label htmlFor="agent-auth-role-arn">Role ARN</Label>
                  <Input
                    id="agent-auth-role-arn"
                    value={roleArn}
                    placeholder="arn:aws:iam::123456789012:role/proliferate-bedrock"
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setRoleArn(event.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="agent-auth-region">Region</Label>
                  <Input
                    id="agent-auth-region"
                    value={region}
                    placeholder="us-east-1"
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setRegion(event.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="agent-auth-external-id">External ID</Label>
                  <Input
                    id="agent-auth-external-id"
                    value={externalId}
                    placeholder="proliferate-..."
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setExternalId(event.target.value)}
                  />
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 text-xs text-muted-foreground">
                {feedback ?? "Secrets are stored in Cloud and never displayed after saving."}
              </p>
              <Button
                type="button"
                variant="secondary"
                loading={mutations.isCreatingCredential}
                disabled={!canCreate}
                onClick={() => { void handleCreateCredential(); }}
              >
                Add credential
              </Button>
            </div>
          </>
        )}
      </div>
    </SettingsCard>
  );
}

function providerOptionsForCapabilities(
  capabilities: AgentGatewayCapabilities | null,
): { value: ProviderChoice; label: string }[] {
  if (!capabilities?.enabled || !capabilities.byokEnabled) {
    return [];
  }
  return PROVIDER_OPTIONS.filter((option) => {
    if (option.value === "anthropic_api_key") {
      return capabilities.byokProviders.anthropicApiKey;
    }
    if (option.value === "openai_api_key") {
      return capabilities.byokProviders.openaiApiKey;
    }
    if (option.value === "bedrock_assume_role") {
      return capabilities.byokProviders.bedrockAssumeRole;
    }
    if (option.value === "openai_compatible") {
      return capabilities.byokProviders.openaiCompatible;
    }
    return false;
  });
}

function createPayloadReady(
  providerKind: ProviderChoice,
  values: {
    apiKey: string;
    baseUrl: string;
    roleArn: string;
    region: string;
    externalId: string;
  },
) {
  if (providerKind === "anthropic_api_key" || providerKind === "openai_api_key") {
    return values.apiKey.trim().length > 0;
  }
  if (providerKind === "openai_compatible") {
    return values.apiKey.trim().length > 0 && values.baseUrl.trim().length > 0;
  }
  return values.roleArn.trim().length > 0
    && values.region.trim().length > 0
    && values.externalId.trim().length > 0;
}

function isAdminOrganization(organization: OrganizationOption): boolean {
  const role = organization.membership?.role;
  return role === "owner" || role === "admin";
}

function buildCreateCredentialRequest(input: {
  providerKind: ProviderChoice;
  agentKind: Extract<AgentAuthAgentKind, "codex" | "opencode">;
  ownerScope: "personal" | "organization";
  organizationId: string | null;
  displayName: string;
  apiKey: string;
  baseUrl: string;
  roleArn: string;
  region: string;
  externalId: string;
}): CreateGatewayCredentialRequest {
  const agentKind = input.providerKind === "openai_api_key"
    || input.providerKind === "openai_compatible"
    ? input.agentKind
    : "claude";
  const payload: Record<string, string> = input.providerKind === "bedrock_assume_role"
    ? {
        roleArn: input.roleArn.trim(),
        region: input.region.trim(),
        externalId: input.externalId.trim(),
      }
    : input.providerKind === "openai_compatible"
      ? {
          baseUrl: input.baseUrl.trim(),
          apiKey: input.apiKey.trim(),
        }
      : { apiKey: input.apiKey.trim() };

  return {
    ownerScope: input.ownerScope,
    organizationId: input.ownerScope === "organization" ? input.organizationId : null,
    agentKind,
    displayName: input.displayName.trim(),
    policyKind: input.ownerScope === "organization" ? "org_byok" : "personal_byok",
    providerKind: input.providerKind,
    payload,
  };
}
