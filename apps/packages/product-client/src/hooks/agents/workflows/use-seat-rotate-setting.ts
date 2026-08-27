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
  /**
   * True once BOTH reads behind a write have landed: the settings rider AND
   * the selections the editor seeds its state from. The switch must stay
   * disabled (and `setRotate` a no-op) until then — the PUT below sends the
   * editor's state as the full desired source list, and before the seed that
   * state is the default (seatEnabled=false, rows=[]), so a click in that
   * window would PUT `sources: []` and disable the seat pool server-side.
   */
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

  // The editor seeds `editorState` from the selections query in an effect that
  // runs once that query resolves — so a resolved selections query is the
  // seeded-editor signal (React flushes passive effects before dispatching a
  // discrete event like the switch click, so a click can never observe the
  // resolved-but-not-yet-seeded render). Until then the editor's state is the
  // unseeded default and MUST NOT be written anywhere.
  const editorSeeded = editor.selectionsQuery.data !== undefined;

  function setRotate(next: boolean) {
    if (!editorSeeded) {
      return;
    }
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
    loaded: settingsQuery.data !== undefined && editorSeeded,
    busy: putSelections.isPending,
    setRotate,
  };
}
