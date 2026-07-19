import { useCallback, useEffect, useRef, useState } from "react";
// The xterm terminal stylesheet is co-located with the terminal surface (not
// the eager product CSS entry) so it rides the lazy authenticated terminal
// chunk alongside the dynamically imported xterm runtime below. The phase-6
// cutover contract forbids the login/callback shell from eagerly loading
// xterm/terminal CSS; this hook is only reachable through the lazy
// AuthenticatedProductClient boundary.
import "@xterm/xterm/css/xterm.css";
import { getTerminalTheme, onThemeChange } from "#product/config/theme";
import { resolveReadableCodeFontScale } from "#product/lib/domain/preferences/appearance";
import { TERMINAL_FONT_FAMILY } from "#product/lib/domain/terminals/terminal-grid";
import { useUserPreferencesStore } from "#product/stores/preferences/user-preferences-store";

interface UseXtermSurfaceInput {
  visible: boolean;
  focusRequestToken: number;
  onData?: (data: string) => void;
  onResize?: (size: { cols: number; rows: number }) => void;
  logPrefix?: string;
  scrollback?: number;
  fontSize?: number;
  lineHeight?: number;
}

export function resolveXtermSurfaceTypography(
  readableCodeFontSizeId: unknown,
  overrides: Pick<UseXtermSurfaceInput, "fontSize" | "lineHeight"> = {},
): { fontSize: number; lineHeight: number } {
  const scale = resolveReadableCodeFontScale(readableCodeFontSizeId);
  return {
    fontSize: overrides.fontSize ?? scale.monacoFontSize,
    lineHeight: overrides.lineHeight ?? scale.monacoLineHeight / scale.monacoFontSize,
  };
}

export function useXtermSurface({
  visible,
  focusRequestToken,
  onData,
  onResize,
  logPrefix = "TerminalViewport",
  scrollback = 5000,
  fontSize,
  lineHeight,
}: UseXtermSurfaceInput) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const fitAddonRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
  const onDataRef = useRef(onData);
  const onResizeRef = useRef(onResize);
  const [isReady, setIsReady] = useState(false);
  const [hasBeenVisible, setHasBeenVisible] = useState(visible);
  const readableCodeFontSizeId = useUserPreferencesStore((state) => state.readableCodeFontSizeId);
  const terminalTypography = resolveXtermSurfaceTypography(readableCodeFontSizeId, {
    fontSize,
    lineHeight,
  });
  const terminalFontSize = terminalTypography.fontSize;
  const terminalLineHeight = terminalTypography.lineHeight;
  const terminalFontSizeRef = useRef(terminalFontSize);
  const terminalLineHeightRef = useRef(terminalLineHeight);

  useEffect(() => {
    onDataRef.current = onData;
  }, [onData]);

  useEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);

  useEffect(() => {
    if (visible) {
      setHasBeenVisible(true);
    }
  }, [visible]);

  useEffect(() => {
    terminalFontSizeRef.current = terminalFontSize;
    terminalLineHeightRef.current = terminalLineHeight;
    const term = terminalRef.current;
    if (!term) {
      return;
    }
    term.options.fontSize = terminalFontSize;
    term.options.lineHeight = terminalLineHeight;
    requestAnimationFrame(() => {
      fitAddonRef.current?.fit();
    });
  }, [terminalFontSize, terminalLineHeight]);

  useEffect(() => {
    if (!hasBeenVisible) return;
    const container = containerRef.current;
    if (!container) return;
    if (terminalRef.current) return;

    setIsReady(false);
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    let unsubscribeTheme = () => {};

    void (async () => {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      const { WebLinksAddon } = await import("@xterm/addon-web-links");

      if (cancelled || !containerRef.current || terminalRef.current) return;

      let term: import("@xterm/xterm").Terminal;
      let fitAddon: import("@xterm/addon-fit").FitAddon;

      try {
        term = new Terminal({
          cursorBlink: true,
          fontSize: terminalFontSizeRef.current,
          lineHeight: terminalLineHeightRef.current,
          fontFamily: TERMINAL_FONT_FAMILY,
          theme: getTerminalTheme(),
          allowTransparency: true,
          scrollback,
        });

        fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.loadAddon(new WebLinksAddon());

        if (cancelled || !containerRef.current) {
          term.dispose();
          return;
        }

        term.open(containerRef.current);
        fitAddon.fit();
      } catch (err) {
        console.warn(`[${logPrefix}] xterm init error (likely disposal race):`, err);
        return;
      }

      if (cancelled) {
        term.dispose();
        return;
      }

      terminalRef.current = term;
      fitAddonRef.current = fitAddon;

      unsubscribeTheme = onThemeChange(() => {
        term.options.theme = getTerminalTheme();
      });

      term.onData((data) => {
        onDataRef.current?.(data);
      });

      term.onResize((size) => {
        onResizeRef.current?.(size);
      });

      resizeObserver = new ResizeObserver(() => {
        if (!cancelled) fitAddon.fit();
      });
      resizeObserver.observe(containerRef.current);
      setIsReady(true);
    })();

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      unsubscribeTheme();
      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      setIsReady(false);
    };
  }, [hasBeenVisible, logPrefix, scrollback]);

  useEffect(() => {
    if (visible && isReady && fitAddonRef.current) {
      requestAnimationFrame(() => {
        fitAddonRef.current?.fit();
        terminalRef.current?.focus();
      });
    }
  }, [focusRequestToken, isReady, visible]);

  const write = useCallback((data: string | Uint8Array) => {
    terminalRef.current?.write(data);
  }, []);

  const clear = useCallback(() => {
    terminalRef.current?.clear();
  }, []);

  const fit = useCallback(() => {
    fitAddonRef.current?.fit();
  }, []);

  return {
    clear,
    containerRef,
    fit,
    isReady,
    terminalRef,
    write,
  };
}
