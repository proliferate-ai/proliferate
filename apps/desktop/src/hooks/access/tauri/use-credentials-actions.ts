import { useMemo } from "react";
import {
  deleteEnvVarSecret,
  listConfiguredEnvVarNames,
  setEnvVarSecret,
} from "@/lib/access/tauri/credentials";

export function useTauriCredentialsActions() {
  return useMemo(() => ({
    deleteEnvVarSecret,
    listConfiguredEnvVarNames,
    setEnvVarSecret,
  }), []);
}
