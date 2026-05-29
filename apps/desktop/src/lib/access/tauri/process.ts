import { invoke } from "@tauri-apps/api/core";

export async function commandExists(command: string): Promise<boolean> {
  return invoke<boolean>("command_exists", { command });
}
