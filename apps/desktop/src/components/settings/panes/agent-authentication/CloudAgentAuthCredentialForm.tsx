import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import type {
  AgentGatewayCapabilities,
} from "@proliferate/cloud-sdk";
import { useAgentAuthMutations } from "@proliferate/cloud-sdk-react/hooks/agent-auth";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@proliferate/ui/primitives/Label";
import { Select } from "@proliferate/ui/primitives/Select";
import { Badge } from "@proliferate/ui/primitives/Badge";
import { SettingsSection } from "@proliferate/product-ui/settings/SettingsSection";
import { SettingsRow } from "@proliferate/product-ui/settings/SettingsRow";
import { agentAuthByokCapabilityLabel } from "@/lib/domain/agent-auth/agent-auth-gateway-capabilities";
import {
  agentAuthGatewayCreatePayloadReady,
  agentAuthGatewayProviderOptionsForCapabilities,
  buildAgentAuthGatewayCredentialRequest,
  type AgentAuthGatewayProviderChoice,
} from "@/lib/domain/agent-auth/agent-auth-gateway-form";

export interface CloudAgentAuthCredentialFormProps {
  agentGatewayCapabilities: AgentGatewayCapabilities | null;
}

export function CloudAgentAuthCredentialForm({
  agentGatewayCapabilities,
}: CloudAgentAuthCredentialFormProps) {
  const mutations = useAgentAuthMutations();
  const providerOptions = useMemo(
    () => agentAuthGatewayProviderOptionsForCapabilities(agentGatewayCapabilities),
    [agentGatewayCapabilities],
  );
  const gatewayByokEnabled = providerOptions.length > 0;
  const [providerKind, setProviderKind] = useState<AgentAuthGatewayProviderChoice>(
    "anthropic_api_key",
  );
  const [displayName, setDisplayName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [roleArn, setRoleArn] = useState("");
  const [region, setRegion] = useState("us-east-1");
  const [externalId, setExternalId] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const personalByokAvailable = agentGatewayCapabilities?.byokPersonalEnabled === true;
  const canCreate =
    displayName.trim().length > 0
    && personalByokAvailable
    && agentAuthGatewayCreatePayloadReady(
      providerKind,
      { apiKey, baseUrl, roleArn, region, externalId },
    );

  useEffect(() => {
    if (providerOptions.length > 0 && !providerOptions.some((option) => option.value === providerKind)) {
      setProviderKind(providerOptions[0].value);
    }
  }, [providerKind, providerOptions]);

  async function handleCreateCredential() {
    const body = buildAgentAuthGatewayCredentialRequest({
      providerKind,
      ownerScope: "personal",
      organizationId: null,
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
    <>
      <SettingsSection>
        <SettingsRow
          label="Cloud API key credentials"
          description={agentAuthByokCapabilityLabel(agentGatewayCapabilities, "personal")}
        >
          <Badge tone={gatewayByokEnabled ? "success" : "neutral"}>
            {gatewayByokEnabled ? "Available" : "Unavailable"}
          </Badge>
        </SettingsRow>
      </SettingsSection>

      {gatewayByokEnabled ? (
        <div className="space-y-3 border-t border-border py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>New credential owner</Label>
              <div className="mt-1 rounded-md border border-border bg-foreground/5 px-3 py-2 text-ui text-foreground">
                Personal
              </div>
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

          {(providerKind === "anthropic_api_key"
            || providerKind === "openai_api_key"
            || providerKind === "gemini_api_key") && (
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
            <p className="min-w-0 text-ui-sm text-muted-foreground">
              {feedback ?? "Secrets stay in the cloud and are never injected into hosted sandboxes."}
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
      ) : (
        <div className="border-t border-border py-3 text-ui-sm leading-[1.45] text-muted-foreground">
          API key, OpenAI-compatible, and Bedrock credential forms appear here when
          this deployment enables provider BYOK support.
        </div>
      )}
    </>
  );
}
