import { useCallback, useMemo, useState } from "react";
import {
  fetchServerMeta,
  isTauriRuntimeAvailable,
} from "@/lib/access/tauri/connect-server";
import { setDesktopAppConfig } from "@/lib/access/tauri/config";
import { relaunch } from "@/lib/access/tauri/updater";
import {
  getRuntimeDesktopAppConfig,
  isOfficialHostedApiBaseUrl,
} from "@/lib/infra/proliferate-api";
import {
  normalizeServerUrl,
  type ServerMeta,
} from "@/lib/domain/auth/connect-server";

export type ConnectServerStep =
  | "closed"
  | "entry"
  | "checking"
  | "trust-confirm"
  | "connecting";

export interface UseConnectServerResult {
  /** False in the web build (no Tauri, no `set_app_config` command). */
  available: boolean;
  /** The custom server the app is currently pointed at, or null on the default. */
  connectedServerHost: string | null;
  step: ConnectServerStep;
  url: string;
  setUrl: (value: string) => void;
  error: string | null;
  pendingMeta: ServerMeta | null;
  pendingHost: string | null;
  open: () => void;
  close: () => void;
  submitUrl: () => Promise<void>;
  confirmConnect: () => Promise<void>;
  resetToDefaultServer: () => Promise<void>;
}

/**
 * Owns the connect-to-server flow's state machine (self-hosting-v1 §3.5):
 * entry -> checking (`GET {url}/meta`) -> trust-confirm -> connecting
 * (`set_app_config` + relaunch). Manual entry only for now — the deep-link
 * branch (`proliferate://connect?server=...`) is follow-up (see
 * desktop-navigation.ts and self-hosting-v1.md's backlog table).
 */
export function useConnectServer(): UseConnectServerResult {
  const available = isTauriRuntimeAvailable();
  const [step, setStep] = useState<ConnectServerStep>("closed");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingMeta, setPendingMeta] = useState<ServerMeta | null>(null);
  const [pendingHost, setPendingHost] = useState<string | null>(null);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);

  const currentConfig = getRuntimeDesktopAppConfig();
  const connectedServerHost = useMemo(() => {
    if (!currentConfig.apiBaseUrl || isOfficialHostedApiBaseUrl(currentConfig.apiBaseUrl)) {
      return null;
    }
    try {
      return new URL(currentConfig.apiBaseUrl).host;
    } catch {
      return currentConfig.apiBaseUrl;
    }
  }, [currentConfig.apiBaseUrl]);

  const open = useCallback(() => {
    if (!available) return;
    setUrl("");
    setError(null);
    setPendingMeta(null);
    setPendingHost(null);
    setPendingUrl(null);
    setStep("entry");
  }, [available]);

  const close = useCallback(() => {
    setStep("closed");
    setError(null);
  }, []);

  const submitUrl = useCallback(async () => {
    if (!available) return;
    const normalized = normalizeServerUrl(url);
    if (!normalized.ok) {
      setError(normalized.error);
      return;
    }

    setError(null);
    setStep("checking");
    const result = await fetchServerMeta(normalized.url);
    if (!result.ok) {
      setError(result.error);
      setStep("entry");
      return;
    }

    setPendingUrl(normalized.url);
    setPendingHost(normalized.host);
    setPendingMeta(result.meta);
    setStep("trust-confirm");
  }, [available, url]);

  const confirmConnect = useCallback(async () => {
    if (!available || !pendingUrl) return;
    setStep("connecting");
    setError(null);
    try {
      await setDesktopAppConfig({ apiBaseUrl: pendingUrl });
      await relaunch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect to that server.");
      setStep("trust-confirm");
    }
  }, [available, pendingUrl]);

  const resetToDefaultServer = useCallback(async () => {
    if (!available) return;
    setStep("connecting");
    setError(null);
    try {
      await setDesktopAppConfig({ apiBaseUrl: null });
      await relaunch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset to the default server.");
      setStep("closed");
    }
  }, [available]);

  return {
    available,
    connectedServerHost,
    step,
    url,
    setUrl,
    error,
    pendingMeta,
    pendingHost,
    open,
    close,
    submitUrl,
    confirmConnect,
    resetToDefaultServer,
  };
}
