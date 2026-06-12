import {
  TERMINAL_FONT_FAMILY,
  type TerminalGrid,
} from "@/lib/domain/terminals/terminal-grid";

// Elements that can host a terminal viewport advertise themselves with this
// attribute (value = workspaceId) so terminal creation can measure the grid
// the renderer will actually use.
export const TERMINAL_GRID_PROBE_ATTRIBUTE = "data-terminal-grid-probe";

export interface TerminalGridProbeOptions {
  fontSize: number;
  lineHeight?: number;
}

// The PTY must be created at the exact grid the xterm renderer will display.
// zsh prints its first prompt immediately after spawn, prefixed by the
// PROMPT_SP sequence ("%" + COLUMNS-1 spaces + CR); at a matching width the
// prompt overwrites the "%", at any other width it survives as a stray line.
// Measuring goes through a real offscreen xterm so cell metrics are identical
// to the live surface.
export async function measureWorkspaceTerminalGrid(
  workspaceId: string,
  options: TerminalGridProbeOptions,
): Promise<TerminalGrid | null> {
  const target = findProbeTargetSize(workspaceId);
  if (!target) {
    return null;
  }

  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-10000px";
  host.style.top = "0";
  host.style.width = `${target.width}px`;
  host.style.height = `${target.height}px`;
  host.style.visibility = "hidden";
  host.style.pointerEvents = "none";
  document.body.appendChild(host);

  try {
    const { Terminal } = await import("@xterm/xterm");
    const { FitAddon } = await import("@xterm/addon-fit");
    const term = new Terminal({
      fontSize: options.fontSize,
      ...(options.lineHeight === undefined ? {} : { lineHeight: options.lineHeight }),
      fontFamily: TERMINAL_FONT_FAMILY,
    });
    try {
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(host);
      const proposed = fitAddon.proposeDimensions();
      if (
        !proposed
        || !Number.isFinite(proposed.cols)
        || !Number.isFinite(proposed.rows)
        || proposed.cols < 2
        || proposed.rows < 2
      ) {
        return null;
      }
      return { cols: proposed.cols, rows: proposed.rows };
    } finally {
      term.dispose();
    }
  } catch {
    return null;
  } finally {
    host.remove();
  }
}

function findProbeTargetSize(
  workspaceId: string,
): { width: number; height: number } | null {
  const candidates = document.querySelectorAll(
    `[${TERMINAL_GRID_PROBE_ATTRIBUTE}="${CSS.escape(workspaceId)}"]`,
  );
  // Prefer the innermost laid-out candidate: the panel content element is the
  // exact viewport box when visible; the panel root is the fallback while the
  // terminal pane is still hidden (first terminal in a pane).
  let best: { width: number; height: number } | null = null;
  for (const element of candidates) {
    const rect = element.getBoundingClientRect();
    if (rect.width >= 1 && rect.height >= 1) {
      best = { width: rect.width, height: rect.height };
    }
  }
  return best;
}
