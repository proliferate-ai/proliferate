import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  completeWorkspaceMove,
  cutoverWorkspaceMove,
  exportWorkspaceMove,
  failWorkspaceMove,
  getWorkspaceMove,
  installWorkspaceMove,
  startWorkspaceMove,
  type ExportWorkspaceMoveResponse,
  type FailWorkspaceMoveRequest,
  type InstallWorkspaceMoveRequest,
  type StartWorkspaceMoveRequest,
  type WorkspaceMoveResponse,
} from "@proliferate/cloud-sdk";
import { workspaceMoveKey, workspaceMovesRootKey } from "../lib/query-keys.js";
import { useCloudClient } from "../context/CloudClientProvider.js";

// Phases in which the move is still being driven by a saga step and a poller
// should keep refetching; "cutover" and beyond settle without further server-side
// work so polling stops there too.
const ACTIVE_MOVE_POLL_PHASES = new Set<WorkspaceMoveResponse["phase"]>([
  "started",
  "destination_ready",
  "installed",
]);

export interface UseWorkspaceMoveOptions {
  enabled?: boolean;
  /** Poll while the move is mid-saga. Defaults to 2000ms; pass `false` to disable. */
  pollIntervalMs?: number | false;
}

export function useWorkspaceMove(
  moveId: string | null,
  options: UseWorkspaceMoveOptions = {},
) {
  const { enabled = true, pollIntervalMs = 2000 } = options;
  const client = useCloudClient();
  return useQuery<WorkspaceMoveResponse>({
    queryKey: workspaceMoveKey(moveId),
    queryFn: () => getWorkspaceMove(moveId!, client),
    enabled: enabled && moveId !== null,
    refetchInterval: (query) => {
      if (pollIntervalMs === false) {
        return false;
      }
      const phase = query.state.data?.phase;
      return phase && ACTIVE_MOVE_POLL_PHASES.has(phase) ? pollIntervalMs : false;
    },
    refetchIntervalInBackground: false,
  });
}

export function invalidateWorkspaceMoves(queryClient: QueryClient, moveId?: string | null) {
  void queryClient.invalidateQueries({ queryKey: workspaceMovesRootKey() });
  if (moveId) {
    void queryClient.invalidateQueries({ queryKey: workspaceMoveKey(moveId) });
  }
}

export function useStartWorkspaceMove() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<WorkspaceMoveResponse, Error, StartWorkspaceMoveRequest>({
    mutationFn: (body) => startWorkspaceMove(body, client),
    onSuccess: (move) => {
      queryClient.setQueryData(workspaceMoveKey(move.id), move);
    },
  });
}

export function useInstallWorkspaceMove() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<
    WorkspaceMoveResponse,
    Error,
    { moveId: string; body: InstallWorkspaceMoveRequest }
  >({
    mutationFn: ({ moveId, body }) => installWorkspaceMove(moveId, body, client),
    onSuccess: (move) => {
      queryClient.setQueryData(workspaceMoveKey(move.id), move);
    },
  });
}

export function useExportWorkspaceMove() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<ExportWorkspaceMoveResponse, Error, string>({
    mutationFn: (moveId) => exportWorkspaceMove(moveId, client),
    onSuccess: (response) => {
      invalidateWorkspaceMoves(queryClient, response.moveId);
    },
  });
}

export function useCutoverWorkspaceMove() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<WorkspaceMoveResponse, Error, string>({
    mutationFn: (moveId) => cutoverWorkspaceMove(moveId, client),
    onSuccess: (move) => {
      queryClient.setQueryData(workspaceMoveKey(move.id), move);
    },
  });
}

export function useCompleteWorkspaceMove() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<WorkspaceMoveResponse, Error, string>({
    mutationFn: (moveId) => completeWorkspaceMove(moveId, client),
    onSuccess: (move) => {
      queryClient.setQueryData(workspaceMoveKey(move.id), move);
    },
  });
}

export function useFailWorkspaceMove() {
  const client = useCloudClient();
  const queryClient = useQueryClient();
  return useMutation<
    WorkspaceMoveResponse,
    Error,
    { moveId: string; body: FailWorkspaceMoveRequest }
  >({
    mutationFn: ({ moveId, body }) => failWorkspaceMove(moveId, body, client),
    onSuccess: (move) => {
      queryClient.setQueryData(workspaceMoveKey(move.id), move);
    },
  });
}
