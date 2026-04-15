import type { components } from "../generated/openapi.js";
import type { Session } from "./sessions.js";

type GeneratedCreateReplaySessionResponse =
  components["schemas"]["CreateReplaySessionResponse"];

export type ReplayRecordingSummary =
  components["schemas"]["ReplayRecordingSummary"];
export type ListReplayRecordingsResponse =
  components["schemas"]["ListReplayRecordingsResponse"];
export type ExportReplayRecordingRequest =
  components["schemas"]["ExportReplayRecordingRequest"];
export type ExportReplayRecordingResponse =
  components["schemas"]["ExportReplayRecordingResponse"];
export type CreateReplaySessionRequest =
  components["schemas"]["CreateReplaySessionRequest"];
export type CreateReplaySessionResponse = Omit<
  GeneratedCreateReplaySessionResponse,
  "session"
> & {
  session: Session;
};
export type AdvanceReplaySessionResponse =
  components["schemas"]["AdvanceReplaySessionResponse"];
