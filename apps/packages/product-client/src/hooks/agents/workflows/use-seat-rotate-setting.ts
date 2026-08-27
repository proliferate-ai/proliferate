import type { AgentAuthSurface } from "@proliferate/cloud-sdk";
import {
  useAgentAuthHarnessSettings,
  usePutAuthSelections,
} from "@proliferate/cloud-sdk-react";
import { buildDesiredSources } from "#product/lib/domain/settings/harness-auth-sources";
import type { HarnessAuthEditorApi } from "#product/hooks/agents/workflows/use-harness-auth-editor";
import { HARNESS_PANE_COPY } from "#product/copy/settings/harness-pane";
import { useToastStore } from "#product/stores/toast/toast-store";

export interface SeatRotateSettingApi {
  /** The rider value — `rotate` defaults to true when the rider carries none. */
  rotateEnabled: boolean;
  /** True once the settings rider has been read at least once. */
  loaded: boolean;
  busy: boolean;
  setRotate: (next: boolean) => void;
}

/**
 * The per-harness `rotate` toggle (agent_auth spec §4 "Rotation ownership":
 * rotation is a per-harness toggle riding `agent_auth_harness_settings` — off
 * pins the applied seat; the server never picks seats).
 *
 * Read: the `harness_settings` rider on `GET /state` via
 * `useAgentAuthHarnessSettings` — the rider-only select, so the credential-
 * bearing document body never lands in the cache. Write: the SAME selections
 * PUT the pane already uses, carrying the CURRENT sources unchanged plus
 * `settings: {...existing, rotate}` — unrelated settings keys are preserved.
 * The PUT's onSuccess invalidates the auth-state root, which both re-reads
 * this rider and re-triggers the courier's delivery loop (the settings ride
 * the state document down to the runtime).
 */
export function useSeatRotateSetting(
  harnessKind: string,
  surface: AgentAuthSurface,
  editor: HarnessAuthEditorApi,
): SeatRotateSettingApi {
  const showToast = useToastStore((state) => state.show);
  const settingsQuery = useAgentAuthHarnessSettings(surface, editor.authReady);
  const putSelections = usePutAuthSelections();

  const harnessSettings: Record<string, unknown> =
    settingsQuery.data?.[harnessKind] ?? {};
  const rotate = harnessSettings["rotate"];
  const rotateEnabled = typeof rotate === "boolean" ? rotate : true;

  function setRotate(next: boolean) {
    putSelections.mutate(
      {
        harnessKind,
        surface,
        body: {
          // Full-desired-state PUT: the sources are the editor's current
          // truth, unchanged — this write is about the settings passenger.
          sources: buildDesiredSources(harnessKind, editor.editorState),
          settings: { ...harnessSettings, rotate: next },
        },
      },
      {
        onError: (error: { message?: string }) => {
          showToast(error.message || HARNESS_PANE_COPY.seatRotateUpdateError);
        },
      },
    );
  }

  return {
    rotateEnabled,
    loaded: settingsQuery.data !== undefined,
    busy: putSelections.isPending,
    setRotate,
  };
}
