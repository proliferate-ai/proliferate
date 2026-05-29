import { useMemo } from "react";
import {
  browserWebviewLabel,
  closeBrowserWebview,
  ensureBrowserWebview,
  hideBrowserWebview,
  isBrowserWebviewAvailable,
} from "@/lib/access/tauri/browser-webview";

export function useTauriBrowserWebviewActions() {
  return useMemo(() => ({
    browserWebviewLabel,
    closeBrowserWebview,
    ensureBrowserWebview,
    hideBrowserWebview,
    isBrowserWebviewAvailable,
  }), []);
}
