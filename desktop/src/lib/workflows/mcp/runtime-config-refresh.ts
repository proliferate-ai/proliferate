import type {
  RuntimeArtifactFulfillment,
  RuntimeArtifactKind,
  RuntimeArtifactRef,
  RuntimeCredentialFulfillment,
  RuntimeCredentialRef,
  RuntimeMcpServer,
  RuntimeSkill,
  RuntimeSkillResource,
  RuntimeTextTemplate,
  TargetRuntimeConfigRefreshRequest,
} from "@anyharness/sdk";
import type {
  AnyHarnessClientConnection,
  AnyHarnessResolvedConnection,
} from "@anyharness/sdk-react";
import { materializeCloudMcpServers } from "@proliferate/cloud-sdk/client/mcp_materialization";
import type { ConnectorLaunchResolutionWarning } from "@/lib/domain/mcp/types";
import {
  fulfillRuntimeConfigResolutionRequest,
  listRuntimeConfigResolutionRequests,
  prefetchRuntimeConfig,
  putRuntimeConfig,
} from "@/lib/access/anyharness/runtime-config";

type RuntimeConfigConnection = AnyHarnessClientConnection | AnyHarnessResolvedConnection;
type MaterializedRuntimeConfig = Awaited<ReturnType<typeof materializeCloudMcpServers>>;
type PluginPackage = NonNullable<MaterializedRuntimeConfig["pluginPackages"]>[number];
type PluginPackageSkill = NonNullable<PluginPackage["skills"]>[number];

interface RefreshRuntimeConfigInput {
  connection: RuntimeConfigConnection;
  targetLocation: "local" | "cloud";
  workspacePath: string | null;
}

export interface RuntimeConfigRefreshResult {
  warnings: ConnectorLaunchResolutionWarning[];
}

const ARTIFACT_PREFETCH_MAX_BYTES = 2 * 1024 * 1024;

export async function refreshRuntimeConfigForLaunch(
  input: RefreshRuntimeConfigInput,
): Promise<RuntimeConfigRefreshResult> {
  const materialized = await materializeCloudMcpServers({
    targetLocation: input.targetLocation,
  });
  const artifacts: RuntimeArtifactFulfillment[] = [];
  const credentials: RuntimeCredentialFulfillment[] = [];
  const manifest = await buildRuntimeConfigManifest({
    targetLocation: input.targetLocation,
    workspacePath: input.workspacePath,
    materialized,
    artifacts,
    credentials,
  });
  console.debug("[runtime-config] refresh manifest prepared", {
    source: "desktop",
    targetLocation: input.targetLocation,
    revisionId: manifest.revision.id,
    mcpServerCount: manifest.mcpServers?.length ?? 0,
    skillCount: manifest.skills?.length ?? 0,
    artifactFulfillmentCount: artifacts.length,
    credentialFulfillmentCount: credentials.length,
    pluginPackageCount: materialized.pluginPackages?.length ?? 0,
    warningCount: materialized.warnings.length,
  });
  await putRuntimeConfig(input.connection, manifest);
  const prefetch = await prefetchRuntimeConfig(input.connection, { includeCredentials: true });
  console.debug("[runtime-config] prefetch requested", {
    revisionId: prefetch.revisionId,
    requestCount: prefetch.requestIds?.length ?? 0,
  });
  await fulfillAvailableRuntimeConfigRequests(input.connection, { artifacts, credentials });
  return {
    warnings: [
      ...materialized.warnings.map((warning) => ({
        connectionId: warning.connectionId,
        catalogEntryId: warning.catalogEntryId as ConnectorLaunchResolutionWarning["catalogEntryId"],
        connectorName: warning.connectorName,
        kind: warning.kind,
      } as ConnectorLaunchResolutionWarning)),
    ],
  };
}

async function fulfillAvailableRuntimeConfigRequests(
  connection: RuntimeConfigConnection,
  fulfillments: {
    artifacts: RuntimeArtifactFulfillment[];
    credentials: RuntimeCredentialFulfillment[];
  },
) {
  const requests = await listRuntimeConfigResolutionRequests(connection);
  for (const request of requests) {
    const artifactHashes = new Set(request.artifacts?.map((artifact) => artifact.hash) ?? []);
    const credentialRefs = new Set(
      request.credentialRefs?.map((credential) => credential.ref) ?? [],
    );
    const artifacts = fulfillments.artifacts.filter((artifact) =>
      artifactHashes.has(artifact.hash)
    );
    const credentials = fulfillments.credentials.filter((credential) =>
      credentialRefs.has(credential.ref)
    );
    if (artifacts.length === 0 && credentials.length === 0) {
      continue;
    }
    console.debug("[runtime-config] fulfilling resolution request", {
      requestId: request.requestId,
      kind: request.kind,
      artifactCount: artifacts.length,
      credentialCount: credentials.length,
    });
    await fulfillRuntimeConfigResolutionRequest(connection, request.requestId, {
      artifacts,
      credentials,
    });
  }
}

async function buildRuntimeConfigManifest(input: {
  targetLocation: "local" | "cloud";
  workspacePath: string | null;
  materialized: MaterializedRuntimeConfig;
  artifacts: RuntimeArtifactFulfillment[];
  credentials: RuntimeCredentialFulfillment[];
}): Promise<TargetRuntimeConfigRefreshRequest> {
  const revisionId = crypto.randomUUID();
  const mcpServers: RuntimeMcpServer[] = [
    ...input.materialized.mcpServers.map((server) => {
      if (server.transport === "http") {
        const credentialRefs: RuntimeCredentialRef[] = [];
        return {
          id: `${server.connectionId}:${server.serverName}`,
          connectionId: server.connectionId,
          catalogEntryId: server.catalogEntryId ?? undefined,
          serverName: server.serverName,
            launch: {
              transport: "http",
              baseUrl: stripQuery(server.url),
              query: queryTemplates({
                url: server.url,
                connectionId: server.connectionId,
                catalogEntryId: server.catalogEntryId ?? undefined,
                credentialRefs,
                credentials: input.credentials,
              }),
            headers: (server.headers ?? []).map((header, index) => {
              const rendered = textTemplateForValue({
                connectionId: server.connectionId,
                catalogEntryId: server.catalogEntryId ?? undefined,
                fieldId: `header:${header.name.toLowerCase()}:${index}`,
                value: header.value,
                forceCredential: header.name.toLowerCase() === "authorization",
                credentialRefs,
                credentials: input.credentials,
              });
              return { name: header.name, value: rendered };
            }),
          },
          credentialRefs,
        } satisfies RuntimeMcpServer;
      }
      return {
        id: `${server.connectionId}:${server.serverName}`,
        connectionId: server.connectionId,
        catalogEntryId: server.catalogEntryId ?? undefined,
        serverName: server.serverName,
        launch: {
          transport: "stdio",
          command: server.command,
          args: (server.args ?? []).map((value) => literalTemplate(value)),
          env: (server.env ?? []).map((env) => ({
            name: env.name,
            value: literalTemplate(env.value),
          })),
        },
        credentialRefs: [],
      } satisfies RuntimeMcpServer;
    }),
    ...input.materialized.localStdioCandidates.map((candidate) => ({
      id: `${candidate.connectionId}:${candidate.serverName}`,
      connectionId: candidate.connectionId,
      catalogEntryId: candidate.catalogEntryId,
      serverName: candidate.serverName,
      launch: {
        transport: "stdio",
        command: candidate.command,
        args: candidate.args.map((arg) =>
          arg.source.kind === "workspace_path"
            ? workspacePathTemplate()
            : literalTemplate(arg.source.value)
        ),
        env: candidate.env.map((env) => ({
          name: env.name,
          value: literalTemplate(env.source.value),
        })),
      },
      credentialRefs: [],
    } satisfies RuntimeMcpServer)),
  ];
  const skills = await runtimeSkillsFromPluginPackages({
    pluginPackages: input.materialized.pluginPackages ?? [],
    mcpServers,
    artifacts: input.artifacts,
  });
  const manifest: TargetRuntimeConfigRefreshRequest = {
    revision: {
      id: revisionId,
      sequence: Date.now(),
      generatedAt: new Date().toISOString(),
      contentHash: revisionId,
      ownerScope: "personal",
      externalTargetId: undefined,
    },
    mcpServers,
    mcpBindingSummaries: input.materialized.mcpBindingSummaries.map((summary) => ({
      ...summary,
      displayName: summary.displayName ?? undefined,
      reason:
        summary.reason === "invalid_settings"
          ? "resolver_error"
          : summary.reason ?? undefined,
    })),
    skills,
    artifacts: [],
    source: "desktop",
  };
  manifest.revision.contentHash = hashRuntimeConfig(manifest);
  return manifest;
}

async function runtimeSkillsFromPluginPackages(input: {
  pluginPackages: readonly PluginPackage[];
  mcpServers: readonly RuntimeMcpServer[];
  artifacts: RuntimeArtifactFulfillment[];
}): Promise<RuntimeSkill[]> {
  const skills: RuntimeSkill[] = [];
  for (const pluginPackage of input.pluginPackages) {
    const packageServers = input.mcpServers.filter(
      (server) => server.catalogEntryId === pluginPackage.catalogEntryId,
    );
    for (const skill of (pluginPackage.skills ?? []).filter((candidate) => candidate.defaultEnabled)) {
      const requiredServers = concreteRequiredMcpServers({
        skill,
        packageServers,
        allServers: input.mcpServers,
      });
      if (requiredServers.length === 0) {
        console.debug("[runtime-config] skipping skill with no concrete MCP server", {
          packageId: pluginPackage.id,
          catalogEntryId: pluginPackage.catalogEntryId,
          skillId: skill.id,
          requiredMcpServerRefs: skill.requiredMcpServerRefs,
        });
        continue;
      }
      const connectionId = packageServers[0]?.connectionId ?? pluginPackage.catalogEntryId;
      const instructionArtifact = await artifactRef({
        content: skill.instructions,
        contentType: "text/markdown",
        kind: "skill_instruction",
        sourceRef: `${pluginPackage.id}:${skill.id}:instructions`,
        artifacts: input.artifacts,
      });
      const resources = await Promise.all(
        (skill.resources ?? []).map((resource): Promise<RuntimeSkillResource> => (
          artifactRef({
            content: resource.content,
            contentType: resource.contentType,
            kind: "skill_resource",
            sourceRef: `${pluginPackage.id}:${skill.id}:${resource.resourceId}`,
            artifacts: input.artifacts,
          }).then((artifact) => ({
            resourceId: resource.resourceId,
            displayName: resource.displayName ?? undefined,
            artifact,
          }))
        )),
      );
      skills.push({
        id: `connector.${connectionId}.${skill.id}`,
        packageId: pluginPackage.id,
        version: pluginPackage.version,
        displayName: skill.displayName,
        description: skill.description,
        instructionArtifact,
        resources,
        requiredMcpServerIds: requiredServers,
        credentialRefs: [],
      });
    }
  }
  return skills;
}

function concreteRequiredMcpServers(input: {
  skill: PluginPackageSkill;
  packageServers: readonly RuntimeMcpServer[];
  allServers: readonly RuntimeMcpServer[];
}): string[] {
  const refs = new Set(input.skill.requiredMcpServerRefs);
  if (refs.size === 0) {
    return input.packageServers.map((server) => server.serverName);
  }
  const matchedServers = input.allServers.filter(
    (server) => refs.has(server.catalogEntryId ?? "") || refs.has(server.serverName),
  );
  return [...new Set(matchedServers.map((server) => server.serverName))];
}

async function artifactRef(input: {
  content: string;
  contentType: string;
  kind: RuntimeArtifactKind;
  sourceRef: string;
  artifacts: RuntimeArtifactFulfillment[];
}): Promise<RuntimeArtifactRef> {
  const bytes = new TextEncoder().encode(input.content);
  const hash = await sha256Hex(bytes);
  const artifact = {
    hash,
    contentType: input.contentType,
    byteSize: bytes.byteLength,
    kind: input.kind,
    sourceRef: input.sourceRef,
  } satisfies RuntimeArtifactRef;
  if (bytes.byteLength <= ARTIFACT_PREFETCH_MAX_BYTES) {
    input.artifacts.push({
      hash,
      contentBase64: bytesToBase64(bytes),
    });
  }
  return artifact;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytesToArrayBuffer(bytes));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function textTemplateForValue(input: {
  connectionId: string;
  catalogEntryId?: string;
  fieldId: string;
  value: string;
  forceCredential: boolean;
  credentialRefs: RuntimeCredentialRef[];
  credentials: RuntimeCredentialFulfillment[];
}): RuntimeTextTemplate {
  if (!input.forceCredential && !looksSensitive(input.value)) {
    return literalTemplate(input.value);
  }
  const credentialRef = `${input.connectionId}:${input.fieldId}`;
  const bearerPrefix = input.value.toLowerCase().startsWith("bearer ")
    ? input.value.slice(0, 7)
    : "";
  input.credentialRefs.push({
    ref: credentialRef,
    kind: input.forceCredential ? "oauth_access_token" : "secret_field",
    connectionId: input.connectionId,
    catalogEntryId: input.catalogEntryId,
    fieldId: input.fieldId,
  });
  input.credentials.push({
    ref: credentialRef,
    value: bearerPrefix ? input.value.slice(7) : input.value,
    redactedSummary: "ready",
  });
  return {
    parts: [
      ...(bearerPrefix ? [{ kind: "literal" as const, value: bearerPrefix }] : []),
      { kind: "credential", ref: credentialRef },
    ],
  };
}

function literalTemplate(value: string): RuntimeTextTemplate {
  return { parts: [{ kind: "literal", value }] };
}

function workspacePathTemplate(): RuntimeTextTemplate {
  return { parts: [{ kind: "workspacePath" }] };
}

function stripQuery(value: string): string {
  const url = new URL(value);
  url.search = "";
  return url.toString();
}

function queryTemplates(input: {
  url: string;
  connectionId: string;
  catalogEntryId?: string;
  credentialRefs: RuntimeCredentialRef[];
  credentials: RuntimeCredentialFulfillment[];
}) {
  const url = new URL(input.url);
  return [...url.searchParams.entries()].map(([name, queryValue], index) => ({
    name,
    value: textTemplateForValue({
      connectionId: input.connectionId,
      catalogEntryId: input.catalogEntryId,
      fieldId: `query:${name}:${index}`,
      value: queryValue,
      forceCredential: looksSensitiveName(name),
      credentialRefs: input.credentialRefs,
      credentials: input.credentials,
    }),
  }));
}

function looksSensitiveName(value: string): boolean {
  const lower = value.toLowerCase();
  return lower.includes("token") || lower.includes("secret") || lower.includes("key");
}

function looksSensitive(value: string): boolean {
  const lower = value.toLowerCase();
  return lower.startsWith("bearer ") || lower.includes("token=") || lower.includes("api_key");
}

function hashRuntimeConfig(manifest: TargetRuntimeConfigRefreshRequest): string {
  const encoded = JSON.stringify({
    ...manifest,
    revision: { ...manifest.revision, contentHash: "" },
  });
  let hash = 2166136261;
  for (let index = 0; index < encoded.length; index += 1) {
    hash ^= encoded.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `desktop-${(hash >>> 0).toString(36)}`;
}
