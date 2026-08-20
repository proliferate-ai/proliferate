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
