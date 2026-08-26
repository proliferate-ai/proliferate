// TODO(cull-trail): the server's harness-launch-options surface is deleted, so
// these shapes no longer arrive from `@proliferate/cloud-sdk`. They are pinned
// here because the composer launch-control domain (and the mobile launch UI
// that renders it) still projects this model; every remaining producer is a
// local/runtime-lane projection or an explicit "unavailable" stub. When the
// mobile launch flow is repointed at the runtime launch-options lane, this
// model should be re-derived from that contract.

export type CloudHarnessLaunchOptionsState =
  | "detecting"
  | "refreshing"
  | "observed"
  | "observed_empty"
  | "last_good_after_failure"
  | "failed_without_observation";

export interface CloudHarnessLaunchModel {
  id: string;
  observedName: string | null;
  observedDescription: string | null;
}

export interface CloudHarnessLaunchControlValue {
  value: string;
  observedLabel: string | null;
  observedDescription: string | null;
}

export interface CloudHarnessLaunchControl {
  id: string;
  observedLabel: string | null;
  observedDescription: string | null;
  values: CloudHarnessLaunchControlValue[];
}

export interface CloudHarnessLaunchModelControls {
  modelId: string;
  controls: CloudHarnessLaunchControl[];
  defaultControlValues: Record<string, string>;
}

export interface CloudHarnessLaunchOptionsResponse {
  harnessKind: string;
  basisRevision: string;
  revision: number;
  state: CloudHarnessLaunchOptionsState;
  options: {
    models: CloudHarnessLaunchModel[];
    controls: CloudHarnessLaunchControl[];
    defaults: {
      modelId: string | null;
      controlValues: Record<string, string>;
    };
    modelControls?: CloudHarnessLaunchModelControls[];
  } | null;
  observedAt: string | null;
  probeAttemptedAt: string;
  probeFailureCode: string | null;
  readiness:
    | "ready"
    | "install_required"
    | "credentials_required"
    | "login_required"
    | "unsupported"
    | "error";
}
