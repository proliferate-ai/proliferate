import { useCallback, useEffect, useRef, useState } from "react";
import { getTerminalTheme, onThemeChange } from "@/config/theme";
import { resolveReadableCodeFontScale } from "@/lib/domain/preferences/appearance";
import { TERMINAL_FONT_FAMILY } from "@/lib/domain/terminals/terminal-grid";
import { useUserPreferencesStore } from "@/stores/preferences/user-preferences-store";

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
  const terminalFontSize = fontSize
    ?? resolveReadableCodeFontScale(readableCodeFontSizeId).monacoFontSize;
  const terminalFontSizeRef = useRef(terminalFontSize);

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
    const term = terminalRef.current;
    if (!term) {
      return;
    }
    term.options.fontSize = terminalFontSize;
    if (lineHeight !== undefined) {
      term.options.lineHeight = lineHeight;
    }
    requestAnimationFrame(() => {
      fitAddonRef.current?.fit();
    });
  }, [lineHeight, terminalFontSize]);

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
          ...(lineHeight === undefined ? {} : { lineHeight }),
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
