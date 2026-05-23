import type { components } from "../generated/openapi.js";

export type CloudTargetKind =
  | "managed_cloud"
  | "ssh"
  | "desktop_dispatch"
  | "local_direct"
  | "self_hosted_cloud";

export type CloudTargetStatus = "online" | "offline" | "degraded" | "enrolling" | "archived";
export type CloudTargetUpdateChannel = "stable" | "beta" | "pinned";

export type CloudTargetInventory = components["schemas"]["CloudTargetInventoryModel"];

export type CloudTargetStatusDetail = Omit<
  components["schemas"]["CloudTargetStatusModel"],
  "status"
> & {
  status: CloudTargetStatus;
};

export type CloudTargetSummary = Omit<
  components["schemas"]["CloudTargetSummary"],
  "kind" | "status" | "ownerScope" | "statusDetail"
> & {
  kind: CloudTargetKind;
  status: CloudTargetStatus;
  ownerScope: "personal" | "organization";
  statusDetail?: CloudTargetStatusDetail | null;
};

export type CloudTargetDetail = Omit<
  components["schemas"]["CloudTargetDetail"],
  "kind" | "status" | "ownerScope" | "statusDetail"
> & {
  kind: CloudTargetKind;
  status: CloudTargetStatus;
  ownerScope: "personal" | "organization";
  statusDetail?: CloudTargetStatusDetail | null;
};

export type CloudTargetEnrollmentRequest = Omit<
  components["schemas"]["CloudTargetEnrollmentRequest"],
  "kind"
> & {
  kind: Exclude<CloudTargetKind, "local_direct" | "managed_cloud">;
};

export type CloudTargetEnrollmentResponse =
  components["schemas"]["CloudTargetEnrollmentResponse"];

export type CloudTargetExistingEnrollmentRequest =
  components["schemas"]["CloudTargetExistingEnrollmentRequest"];

export type ArchiveCloudTargetResponse =
  components["schemas"]["ArchiveCloudTargetResponse"];

export type SetDesiredVersionsRequest = Omit<
  components["schemas"]["SetDesiredVersionsRequest"],
  "updateChannel"
> & {
  updateChannel?: CloudTargetUpdateChannel | null;
};

export type SetDesiredVersionsResponse =
  components["schemas"]["SetDesiredVersionsResponse"];

export type SafeStopCheckResponse =
  components["schemas"]["SafeStopCheckResponse"];

export type RevokeWorkersResponse =
  components["schemas"]["RevokeWorkersResponse"];
