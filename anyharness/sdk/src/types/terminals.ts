import type { components } from "../generated/openapi.js";

export type TerminalStatus = components["schemas"]["TerminalStatus"];
export type TerminalPurpose = components["schemas"]["TerminalPurpose"];
export type TerminalCommandRunStatus = components["schemas"]["TerminalCommandRunStatus"];
export type TerminalCommandOutputMode = components["schemas"]["TerminalCommandOutputMode"];
export type TerminalCommandRunSummary = components["schemas"]["TerminalCommandRunSummary"];
export type TerminalCommandRunDetail = components["schemas"]["TerminalCommandRunDetail"];
export type TerminalRecord = components["schemas"]["TerminalRecord"];
export type CreateTerminalRequest = components["schemas"]["CreateTerminalRequest"];
export type StartTerminalCommandRequest =
  components["schemas"]["StartTerminalCommandRequest"];
export type StartTerminalCommandResponse =
  components["schemas"]["StartTerminalCommandResponse"];
export type ResizeTerminalRequest = components["schemas"]["ResizeTerminalRequest"];
export type UpdateTerminalTitleRequest = components["schemas"]["UpdateTerminalTitleRequest"];
