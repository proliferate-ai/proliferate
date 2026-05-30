import type { AgentLoginTerminalRecord } from "@anyharness/sdk";
import { connectAgentLoginTerminal, type TerminalStreamHandle } from "@anyharness/sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import { useXtermSurface } from "@/hooks/terminals/lifecycle/use-xterm-surface";

interface UseAgentAuthTerminalViewportInput {
  terminal: AgentLoginTerminalRecord | null;
  baseUrl: string;
  authToken?: string;
  visible: boolean;
  focusRequestToken: number;
  onExit: (code: number | null) => void;
}

export function useAgentAuthTerminalViewport({
  terminal,
  baseUrl,
  authToken,
  visible,
  focusRequestToken,
  onExit,
}: UseAgentAuthTerminalViewportInput) {
  const streamHandleRef = useRef<TerminalStreamHandle | null>(null);
  const lastSeqRef = useRef(0);
  const lastTerminalIdRef = useRef<string | null>(null);
  const onExitRef = useRef(onExit);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  useEffect(() => {
    onExitRef.current = onExit;
  }, [onExit]);

  const handleTerminalData = useCallback((data: string) => {
    streamHandleRef.current?.send(data);
  }, []);

  const handleTerminalResize = useCallback(({ cols, rows }: { cols: number; rows: number }) => {
    streamHandleRef.current?.sendResize(cols, rows);
  }, []);

  const { containerRef, isReady, terminalRef, write } = useXtermSurface({
    visible,
    focusRequestToken,
    onData: handleTerminalData,
    onResize: handleTerminalResize,
    logPrefix: "AgentAuthTerminal",
    scrollback: 2000,
    fontSize: 9,
    lineHeight: 1,
  });

  useEffect(() => {
    const terminalId = terminal?.id ?? null;
    const terminalStatus = terminal?.status ?? null;
    if (
      !visible
      || !isReady
      || !terminalId
      || terminalStatus === "exited"
      || terminalStatus === "failed"
      || baseUrl.trim().length === 0
    ) {
      return;
    }

    setConnectionError(null);
    if (lastTerminalIdRef.current !== terminalId) {
      lastSeqRef.current = 0;
      lastTerminalIdRef.current = terminalId;
    }
    const handle = connectAgentLoginTerminal({
      baseUrl,
      authToken,
      terminalId,
      afterSeq: lastSeqRef.current > 0 ? lastSeqRef.current : undefined,
      onData: (data, frame) => {
        lastSeqRef.current = frame.seq;
        write(data);
      },
      onReplayGap: () => {
        write("\r\n[terminal output gap: earlier output was discarded]\r\n");
      },
      onExit: (code) => {
        write("\r\n");
        onExitRef.current(code);
      },
      onError: () => {
        setConnectionError("Terminal connection interrupted.");
      },
    });
    streamHandleRef.current = handle;
    if (terminalRef.current) {
      handle.sendResize(terminalRef.current.cols, terminalRef.current.rows);
    }

    return () => {
      if (streamHandleRef.current === handle) {
        streamHandleRef.current = null;
      }
      handle.close();
    };
  }, [authToken, baseUrl, isReady, terminal, terminalRef, visible, write]);

  return {
    connectionError,
    containerRef,
  };
}
