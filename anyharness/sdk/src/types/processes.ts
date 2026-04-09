export interface RunCommandRequest {
  command: string[];
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface RunCommandResponse {
  stdout: string;
  stderr: string;
  exitCode: number;
}
