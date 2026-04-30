import type {
  CreateTerminalRequest,
  ResizeTerminalRequest,
  TerminalRecord,
  UpdateTerminalTitleRequest,
} from "../types/terminals.js";
import type { AnyHarnessTransport } from "./core.js";

export class TerminalsClient {
  constructor(private readonly transport: AnyHarnessTransport) {}

  async list(workspaceId: string): Promise<TerminalRecord[]> {
    return this.transport.get<TerminalRecord[]>(
      `/v1/workspaces/${encodeURIComponent(workspaceId)}/terminals`,
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
