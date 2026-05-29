import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  ConnectorSettings,
  ConnectOAuthConnectorResult,
  ConfiguredCapabilityItemState,
  InstalledConnectorRecord,
} from "@/lib/domain/mcp/types";
import {
  cancelLocalOAuthConnectorConnect,
  cancelOAuthConnectorConnect,
  connectOAuthConnector,
  deleteConnector,
  installConnector,
  reconnectOAuthConnector,
  setConnectorPublicExposure,
  setConnectorEnabled,
  updateConnectorSecret,
  type ConnectorPaneData,
} from "@/lib/workflows/mcp/connector-persistence";
import { mcpConnectorsKey } from "./query-keys";
import { refreshMcpConnectorsQuery } from "./use-connectors";

export interface InstallConnectorMutationInput {
  catalogEntryId: string;
  secretFields: Record<string, string>;
  settings?: ConnectorSettings;
}

export interface ConnectOAuthConnectorMutationInput {
  catalogEntryId: string;
  connectionId: string;
  settings?: ConnectorSettings;
}

export interface ReconnectOAuthConnectorMutationInput {
  catalogEntryId: string;
  connectionId: string;
  settings?: ConnectorSettings;
}

export interface UpdateConnectorSecretMutationInput {
  catalogEntryId: string;
  connectionId: string;
  secretFields: Record<string, string>;
  settings?: ConnectorSettings;
}

export interface DeleteConnectorMutationInput {
  catalogEntryId: string;
  connectionId: string;
}

export interface ToggleConnectorMutationInput {
  catalogEntryId: string;
  connectionId: string;
  enabled: boolean;
}

export interface SetConnectorPublicExposureMutationInput {
  record: InstalledConnectorRecord;
  organizationId: string;
  publicToOrg: boolean;
}

export function useInstallConnectorMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: InstallConnectorMutationInput) =>
      installConnector(input.catalogEntryId, input.secretFields, input.settings),
    onSuccess: () => refreshMcpConnectorsQuery(queryClient),
  });
}

export function useConnectOAuthConnectorMutation() {
  const queryClient = useQueryClient();

  return useMutation<ConnectOAuthConnectorResult, Error, ConnectOAuthConnectorMutationInput>({
    mutationFn: (input) =>
      connectOAuthConnector(input.catalogEntryId, input.settings, input.connectionId),
    onSuccess: (result) => {
      if (result.kind === "canceled") {
        return;
      }
      return refreshMcpConnectorsQuery(queryClient);
    },
  });
}

export function useReconnectOAuthConnectorMutation() {
  const queryClient = useQueryClient();

  return useMutation<ConnectOAuthConnectorResult, Error, ReconnectOAuthConnectorMutationInput>({
    mutationFn: (input) => reconnectOAuthConnector(input.connectionId, input.settings),
    onSuccess: (result) => {
      if (result.kind === "canceled") {
        return;
      }
      return refreshMcpConnectorsQuery(queryClient);
    },
  });
}

export function useUpdateConnectorSecretMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateConnectorSecretMutationInput) =>
      updateConnectorSecret(input.connectionId, input.secretFields, input.settings),
    onSuccess: () => refreshMcpConnectorsQuery(queryClient),
  });
}

export function useDeleteConnectorMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: DeleteConnectorMutationInput) => deleteConnector(input.connectionId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: mcpConnectorsKey() }),
  });
}

export function useToggleConnectorMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ToggleConnectorMutationInput) =>
      setConnectorEnabled(input.connectionId, input.enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: mcpConnectorsKey() }),
  });
}

export function useSetConnectorPublicExposureMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: SetConnectorPublicExposureMutationInput) =>
      setConnectorPublicExposure(input.record, input.organizationId, input.publicToOrg),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: mcpConnectorsKey() });
      const previous = queryClient.getQueryData<ConnectorPaneData>(mcpConnectorsKey());
      queryClient.setQueryData<ConnectorPaneData>(
        mcpConnectorsKey(),
        (current) => updateConnectorPublicExposureSnapshot(current, input),
      );
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(mcpConnectorsKey(), context.previous);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: mcpConnectorsKey() }),
  });
}

function updateConnectorPublicExposureSnapshot(
  current: ConnectorPaneData | undefined,
  input: SetConnectorPublicExposureMutationInput,
): ConnectorPaneData | undefined {
  if (!current) {
    return current;
  }
  return {
    ...current,
    installed: current.installed.map((record) => {
      if (record.metadata.connectionId !== input.record.metadata.connectionId) {
        return record;
      }
      const publicOrganizationId = input.publicToOrg ? input.organizationId : null;
      const publicStatus = input.publicToOrg ? "public" : "private";
      return {
        ...record,
        metadata: {
          ...record.metadata,
          publicToOrg: input.publicToOrg,
          publicOrganizationId,
          publicStatus,
          configuredPlugin: record.metadata.configuredPlugin
            ? updateConfiguredItemPublicExposure(
                record.metadata.configuredPlugin,
                input.publicToOrg,
                publicOrganizationId,
                publicStatus,
              )
            : record.metadata.configuredPlugin,
          configuredSkills: record.metadata.configuredSkills.map((item) =>
            updateConfiguredItemPublicExposure(
              item,
              input.publicToOrg,
              publicOrganizationId,
              publicStatus,
            )),
        },
      };
    }),
  };
}

function updateConfiguredItemPublicExposure(
  item: ConfiguredCapabilityItemState,
  publicToOrg: boolean,
  publicOrganizationId: string | null,
  publicStatus: string,
): ConfiguredCapabilityItemState {
  return {
    ...item,
    publicToOrg,
    publicOrganizationId,
    publicStatus,
  };
}

export function cancelPendingLocalOAuthConnectorConnect(): Promise<void> {
  return cancelLocalOAuthConnectorConnect();
}

export function cancelPendingOAuthConnectorConnection(connectionId: string): Promise<void> {
  return cancelOAuthConnectorConnect(connectionId);
}
