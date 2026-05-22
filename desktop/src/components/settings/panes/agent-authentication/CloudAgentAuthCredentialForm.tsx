import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import type {
  AgentGatewayCapabilities,
} from "@proliferate/cloud-sdk";
import { useAgentAuthMutations } from "@proliferate/cloud-sdk-react/hooks/agent-auth";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@/components/ui/Label";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { SettingsCardRow } from "@/components/settings/shared/SettingsCardRow";
import {
  agentAuthByokCapabilityLabel,
  isAgentAuthAdminRole,
} from "@/lib/domain/agent-auth/agent-auth-presentation";
import {
  agentAuthGatewayCreatePayloadReady,
  agentAuthGatewayProviderOptionsForCapabilities,
  buildAgentAuthGatewayCredentialRequest,
  type AgentAuthGatewayOpenAiAgentKind,
  type AgentAuthGatewayProviderChoice,
} from "@/lib/domain/agent-auth/agent-auth-gateway-form";

interface OrganizationOption {
  id: string;
  name: string;
  membership?: {
    role?: "owner" | "admin" | "member";
  } | null;
}

export interface CloudAgentAuthCredentialFormProps {
  organizations: OrganizationOption[];
  selectedOrganizationId: string | null;
  onSelectedOrganizationChange: (organizationId: string | null) => void;
  agentGatewayCapabilities: AgentGatewayCapabilities | null;
}

export function CloudAgentAuthCredentialForm({
  organizations,
  selectedOrganizationId,
  onSelectedOrganizationChange,
  agentGatewayCapabilities,
}: CloudAgentAuthCredentialFormProps) {
  const adminOrganizations = organizations.filter(isAdminOrganization);
  const firstAdminOrganizationId = adminOrganizations[0]?.id ?? null;
  const mutations = useAgentAuthMutations();
  const providerOptions = useMemo(
    () => agentAuthGatewayProviderOptionsForCapabilities(agentGatewayCapabilities),
    [agentGatewayCapabilities],
  );
  const gatewayByokEnabled = providerOptions.length > 0;
  const [providerKind, setProviderKind] = useState<AgentAuthGatewayProviderChoice>(
    "anthropic_api_key",
  );
  const [agentKind, setAgentKind] = useState<AgentAuthGatewayOpenAiAgentKind>("codex");
  const [ownerScope, setOwnerScope] = useState<"personal" | "organization">("personal");
  const [displayName, setDisplayName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [roleArn, setRoleArn] = useState("");
  const [region, setRegion] = useState("us-east-1");
  const [externalId, setExternalId] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const selectedOrganizationCanOwnCredential = adminOrganizations.some(
    (organization) => organization.id === selectedOrganizationId,
  );
  const credentialOrganizationId = ownerScope === "organization"
    ? adminOrganizations.find((organization) => organization.id === selectedOrganizationId)?.id
      ?? null
    : null;
  const canCreate =
    displayName.trim().length > 0
    && (ownerScope === "personal" || Boolean(credentialOrganizationId))
    && agentAuthGatewayCreatePayloadReady(
      providerKind,
      { apiKey, baseUrl, roleArn, region, externalId },
    );

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
    const body = buildAgentAuthGatewayCredentialRequest({
      providerKind,
      agentKind,
      ownerScope,
      organizationId: credentialOrganizationId,
      displayName,
      values: { apiKey, baseUrl, roleArn, region, externalId },
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
      <SettingsCardRow
        label="Advanced gateway credentials"
        description={agentAuthByokCapabilityLabel(agentGatewayCapabilities)}
      >
        <Badge tone={gatewayByokEnabled ? "success" : "neutral"}>
          {gatewayByokEnabled ? "Enabled" : "Hidden"}
        </Badge>
      </SettingsCardRow>

      {gatewayByokEnabled && (
        <div className="space-y-3 border-t border-border-light p-4">
          <div className="grid gap-3 sm:grid-cols-2">
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
                    && !selectedOrganizationCanOwnCredential
                    && firstAdminOrganizationId
                  ) {
                    onSelectedOrganizationChange(firstAdminOrganizationId);
                  }
                }}
              >
                <option value="personal">Personal</option>
                <option value="organization" disabled={!firstAdminOrganizationId}>
                  Organization
                </option>
              </Select>
              {ownerScope === "organization" && (
                <p className="mt-1 text-xs leading-4 text-muted-foreground">
                  Saved to {selectedOrganizationName(organizations, selectedOrganizationId)
                    ?? "the selected team"}.
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="agent-auth-provider-kind">Provider</Label>
              <Select
                id="agent-auth-provider-kind"
                value={providerKind}
                onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                  setProviderKind(event.target.value as AgentAuthGatewayProviderChoice)}
              >
                {providerOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {(providerKind === "openai_api_key" || providerKind === "openai_compatible") && (
            <div>
              <Label htmlFor="agent-auth-agent-kind">Harness</Label>
              <Select
                id="agent-auth-agent-kind"
                value={agentKind}
                onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                  setAgentKind(event.target.value as AgentAuthGatewayOpenAiAgentKind)}
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
              {feedback ?? "Secrets stay in Cloud and are never injected into hosted sandboxes."}
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
        </div>
      )}
    </SettingsCard>
  );
}

function isAdminOrganization(organization: OrganizationOption): boolean {
  return isAgentAuthAdminRole(organization.membership?.role);
}

function selectedOrganizationName(
  organizations: OrganizationOption[],
  organizationId: string | null,
): string | null {
  return organizations.find((organization) => organization.id === organizationId)?.name ?? null;
}
