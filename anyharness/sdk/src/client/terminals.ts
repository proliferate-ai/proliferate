import type {
  CreateTerminalRequest,
  ResizeTerminalRequest,
  StartTerminalCommandRequest,
  StartTerminalCommandResponse,
  TerminalCommandRunDetail,
  TerminalRecord,
  UpdateTerminalTitleRequest,
} from "../types/terminals.js";
import type { AnyHarnessRequestOptions, AnyHarnessTransport } from "./core.js";

export class TerminalsClient {
  constructor(private readonly transport: AnyHarnessTransport) {}

  async list(
    workspaceId: string,
    options?: AnyHarnessRequestOptions,
  ): Promise<TerminalRecord[]> {
    return this.transport.get<TerminalRecord[]>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/terminals`,
      options,
    );
  }

  async create(
    workspaceId: string,
    input: CreateTerminalRequest,
  ): Promise<TerminalRecord> {
    return this.transport.post<TerminalRecord>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/terminals`,
      input,
    );
  }

  async get(terminalId: string): Promise<TerminalRecord> {
    return this.transport.get<TerminalRecord>(
      `/v1/terminals/${encodeURIComponent(terminalId)}`,
    );
  }

  async runCommand(
    terminalId: string,
    input: StartTerminalCommandRequest,
  ): Promise<StartTerminalCommandResponse> {
    return this.transport.post<StartTerminalCommandResponse>(
      `/v1/terminals/${encodeURIComponent(terminalId)}/commands`,
      input,
    );
  }

  async getCommandRun(commandRunId: string): Promise<TerminalCommandRunDetail> {
    return this.transport.get<TerminalCommandRunDetail>(
      `/v1/terminal-command-runs/${encodeURIComponent(commandRunId)}`,
    );
  }

  async resize(
    terminalId: string,
    input: ResizeTerminalRequest,
  ): Promise<TerminalRecord> {
    return this.transport.post<TerminalRecord>(
      `/v1/terminals/${encodeURIComponent(terminalId)}/resize`,
      input,
    );
  }

  async updateTitle(
    terminalId: string,
    input: UpdateTerminalTitleRequest,
  ): Promise<TerminalRecord> {
    return this.transport.patch<TerminalRecord>(
      `/v1/terminals/${encodeURIComponent(terminalId)}/title`,
      input,
    );
  }

  async close(terminalId: string): Promise<void> {
    await this.transport.delete(`/v1/terminals/${encodeURIComponent(terminalId)}`);
  }
}
