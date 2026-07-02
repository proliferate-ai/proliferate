import { invoke } from "@tauri-apps/api/core";

export const getDesktopInstallId = () =>
  invoke<string>("get_desktop_install_id");
