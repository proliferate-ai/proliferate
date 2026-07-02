import { useMemo } from "react";
import {
  deleteEnvVarSecret,
  listConfiguredEnvVarNames,
  restartRuntime,
  setEnvVarSecret,
} from "@/lib/access/tauri/credentials";

export function useTauriCredentialsActions() {
  return useMemo(() => ({
    deleteEnvVarSecret,
    listConfiguredEnvVarNames,
    restartRuntime,
    setEnvVarSecret,
  }), []);
}
