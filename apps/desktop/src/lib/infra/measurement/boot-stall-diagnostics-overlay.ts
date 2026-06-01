import {
  BOOT_DIAGNOSTICS_OVERLAY_ID,
  MAX_VISIBLE_EVENTS,
  type BootDiagnosticEvent,
  type BootDiagnosticOverlay,
} from "./boot-stall-diagnostics-types";
import {
  formatBytes,
  formatEventLine,
} from "./boot-stall-diagnostics-format";
import { getMeasurementMemorySnapshot, now, round } from "./debug-measurement-utils";

let overlay: BootDiagnosticOverlay | null = null;

export function ensureBootDiagnosticsOverlay(actions: {
  copy: () => void;
  clear: () => void;
}): BootDiagnosticOverlay | null {
  if (typeof document === "undefined") {
    return null;
  }

  if (overlay) {
    return overlay;
  }

  const existingRoot = document.getElementById(BOOT_DIAGNOSTICS_OVERLAY_ID);
  const root = existingRoot ?? document.createElement("aside");
  root.id = BOOT_DIAGNOSTICS_OVERLAY_ID;
  root.style.cssText = [
    "position:fixed",
    "right:10px",
    "bottom:10px",
    "z-index:2147483647",
    "box-sizing:border-box",
    "width:min(620px,calc(100vw - 20px))",
    "max-height:min(520px,65vh)",
    "overflow:hidden",
    "border:1px solid rgba(255,255,255,.22)",
    "border-radius:8px",
    "background:rgba(11,11,13,.94)",
    "box-shadow:0 18px 50px rgba(0,0,0,.35)",
    "color:#f4f4f5",
    "font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace",
    "letter-spacing:0",
    "pointer-events:auto",
  ].join(";");

  root.innerHTML = [
    "<div data-role=\"header\" style=\"display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.12);font-weight:700;\">",
    "<span style=\"flex:1;\">Boot diagnostics</span>",
    "<button data-action=\"copy\" style=\"border:1px solid rgba(255,255,255,.18);border-radius:5px;background:rgba(255,255,255,.08);color:inherit;padding:2px 7px;font:inherit;\">Copy</button>",
    "<button data-action=\"clear\" style=\"border:1px solid rgba(255,255,255,.18);border-radius:5px;background:rgba(255,255,255,.08);color:inherit;padding:2px 7px;font:inherit;\">Clear</button>",
    "</div>",
    "<div data-role=\"summary\" style=\"padding:7px 10px;color:#d4d4d8;border-bottom:1px solid rgba(255,255,255,.1);\"></div>",
    "<ol data-role=\"events\" style=\"list-style:none;margin:0;padding:6px 10px 9px;overflow:auto;max-height:410px;\"></ol>",
  ].join("");

  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const action = target.dataset.action;
    if (action === "copy") {
      actions.copy();
    }
    if (action === "clear") {
      actions.clear();
    }
  });

  if (!existingRoot) {
    const attach = () => document.body.appendChild(root);
    if (document.body) {
      attach();
    } else {
      document.addEventListener("DOMContentLoaded", attach, { once: true });
    }
  }

  overlay = {
    root,
    summary: root.querySelector<HTMLElement>("[data-role='summary']")!,
    events: root.querySelector<HTMLElement>("[data-role='events']")!,
  };
  return overlay;
}

export function renderBootDiagnosticsOverlay(input: {
  startedAtMs: number;
  lastFrameAtMs: number;
  maxFrameGapMs: number;
  eventCount: number;
  eventSeq: number;
  events: readonly BootDiagnosticEvent[];
  route: string | null;
  fetchStarts: number;
  fetchErrors: number;
  performanceDetailStripCount: number;
  layoutReadInAnimationFrameCount: number;
  copy: () => void;
  clear: () => void;
}): void {
  const currentOverlay = ensureBootDiagnosticsOverlay({
    copy: input.copy,
    clear: input.clear,
  });
  if (!currentOverlay) {
    return;
  }

  const elapsedMs = round(now() - input.startedAtMs);
  const sinceLastFrameMs = round(now() - input.lastFrameAtMs);
  const memory = getMeasurementMemorySnapshot();
  currentOverlay.summary.textContent = [
    `elapsed ${elapsedMs}ms`,
    `events ${input.eventCount}/${input.eventSeq}`,
    `max gap ${round(input.maxFrameGapMs)}ms`,
    `last frame ${sinceLastFrameMs}ms ago`,
    `fetch ${input.fetchStarts}/${input.fetchErrors}err`,
    `measure ${input.performanceDetailStripCount} stripped`,
    `layout ${input.layoutReadInAnimationFrameCount}`,
    memory.usedJSHeapSize === null
      ? "heap n/a"
      : `heap ${formatBytes(memory.usedJSHeapSize)}`,
    input.route ?? "",
  ].filter(Boolean).join(" | ");

  const visibleEvents = input.events.slice(-MAX_VISIBLE_EVENTS).reverse();
  currentOverlay.events.textContent = "";
  for (const event of visibleEvents) {
    const item = document.createElement("li");
    item.style.cssText = [
      "display:grid",
      "grid-template-columns:58px minmax(0,1fr)",
      "gap:8px",
      "padding:2px 0",
      "border-bottom:1px solid rgba(255,255,255,.04)",
    ].join(";");

    const time = document.createElement("span");
    time.style.color = "#a1a1aa";
    time.textContent = `${event.elapsedMs}ms`;

    const body = document.createElement("span");
    body.style.cssText = "min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    body.title = JSON.stringify(event);
    body.textContent = formatEventLine(event);

    item.append(time, body);
    currentOverlay.events.appendChild(item);
  }
}

export function removeBootDiagnosticsOverlay(): void {
  overlay?.root.remove();
  overlay = null;
}
