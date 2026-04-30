import type { components } from "../generated/openapi.js";
import type { Session } from "./sessions.js";
import type { Workspace } from "./workspaces.js";

export type CoworkRoot = components["schemas"]["CoworkRoot"];
export type CoworkStatus = components["schemas"]["CoworkStatus"];
export type CoworkArtifactType = components["schemas"]["CoworkArtifactType"];
export type CoworkArtifactSummary = components["schemas"]["CoworkArtifactSummary"];
export type CoworkArtifactManifestResponse =
  components["schemas"]["CoworkArtifactManifestResponse"];
export type CoworkArtifactDetailResponse =
  components["schemas"]["CoworkArtifactDetailResponse"];
export type CoworkThread = components["schemas"]["CoworkThread"];
export type CreateCoworkThreadRequest =
  components["schemas"]["CreateCoworkThreadRequest"];
export type CoworkManagedWorkspacesResponse =
  components["schemas"]["CoworkManagedWorkspacesResponse"];
export type CoworkManagedWorkspaceSummary =
  components["schemas"]["CoworkManagedWorkspaceSummary"];
export type CoworkCodingSessionSummary =
  components["schemas"]["CoworkCodingSessionSummary"];
type GeneratedCreateCoworkThreadResponse =
  components["schemas"]["CreateCoworkThreadResponse"];
export type CreateCoworkThreadResponse = Omit<
  GeneratedCreateCoworkThreadResponse,
  "workspace" | "session"
> & {
  workspace: Workspace;
  session: Session;
};
