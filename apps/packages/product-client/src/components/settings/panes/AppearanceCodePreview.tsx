import type { CSSProperties, ReactNode } from "react";
import { themePreviewColors } from "@proliferate/design/tokens";

/**
 * The Appearance pane's code preview, drawn to the design mock.
 *
 * This is deliberately NOT the product's DiffViewer. The viewer is built for
 * real review work — file header, context shading, scroll containment — and
 * all of that machinery reads as noise inside a settings pane. The preview's
 * only job is to show five lines of code at the currently selected code font
 * size, with the product's change markers (striped deletion bar, solid
 * addition bar, subtle row tints) so it still reads as "a diff in this app".
 *
 * It stays honest to the ramps the pane controls: the root carries
 * `text-readable-code` + `font-mono`, so the Code font size setting re-renders
 * it live exactly like the real surfaces.
 */

const SYNTAX_KEYWORD_STYLE = { color: themePreviewColors.syntax.keyword } as CSSProperties;
const SYNTAX_TYPE_STYLE = { color: "var(--color-pr-merged)" } as CSSProperties;
const SYNTAX_STRING_STYLE = { color: "var(--color-success)" } as CSSProperties;
const SYNTAX_NUMBER_STYLE = { color: "var(--color-info)" } as CSSProperties;

const DELETION_ROW_STYLE = { background: "var(--color-destructive-subtle)" } as CSSProperties;
const ADDITION_ROW_STYLE = { background: "var(--color-success-subtle)" } as CSSProperties;
const DELETION_NUMBER_STYLE = { color: "var(--color-destructive)" } as CSSProperties;
const ADDITION_NUMBER_STYLE = { color: "var(--color-success)" } as CSSProperties;

/**
 * The change gutters reuse the product's markers — solid 3px bar for
 * additions, the striped bar for deletions. They are inline styles rather than
 * product.css rules on purpose: this component is settings-only, and the
 * global stylesheet ships in the /login first-load bundle, which sits at its
 * byte cap.
 */
type LineKind = "context" | "deletion" | "addition";

const GUTTER_BASE_STYLE = { flex: "none", width: "3px" } as CSSProperties;
const GUTTER_STYLES: Record<LineKind, CSSProperties | undefined> = {
  context: GUTTER_BASE_STYLE,
  addition: { ...GUTTER_BASE_STYLE, background: "var(--color-success)" },
  deletion: {
    ...GUTTER_BASE_STYLE,
    background:
      "repeating-linear-gradient(180deg, var(--color-destructive) 0 3px, transparent 3px 5px)",
  },
};

/** The mock's airy code leading; the readable-code ramp still sets the size. */
const PREVIEW_LINE_HEIGHT_STYLE = { lineHeight: 1.95 } as CSSProperties;

function Line({ number, kind, children }: { number: number; kind: LineKind; children: ReactNode }) {
  const changed = kind !== "context";
  return (
    <div className="flex" style={kind === "deletion" ? DELETION_ROW_STYLE : kind === "addition" ? ADDITION_ROW_STYLE : undefined}>
      <span style={GUTTER_STYLES[kind]} />
      <span
        className={`w-8 shrink-0 select-none pr-3 text-right ${changed ? "" : "text-faint"}`}
        style={kind === "deletion" ? DELETION_NUMBER_STYLE : kind === "addition" ? ADDITION_NUMBER_STYLE : undefined}
      >
        {number}
      </span>
      <span className="whitespace-pre">{children}</span>
    </div>
  );
}

function OpeningLine() {
  return (
    <>
      <span style={SYNTAX_KEYWORD_STYLE}>const </span>
      <span className="text-foreground">ws</span>
      <span style={SYNTAX_TYPE_STYLE}>: Workspace</span>
      <span className="text-foreground"> = {"{"}</span>
    </>
  );
}

function FieldLine({ name, value, numeric }: { name: string; value: string; numeric?: boolean }) {
  return (
    <>
      <span style={SYNTAX_KEYWORD_STYLE}>{"  "}{name}</span>
      <span className="text-foreground">: </span>
      <span style={numeric ? SYNTAX_NUMBER_STYLE : SYNTAX_STRING_STYLE}>{value}</span>
      <span className="text-foreground">,</span>
    </>
  );
}

export function AppearanceCodePreview() {
  return (
    <div className="grid grid-cols-2 py-2 font-mono text-readable-code" style={PREVIEW_LINE_HEIGHT_STYLE}>
      <div className="flex min-w-0 flex-col overflow-hidden">
        <Line number={1} kind="context"><OpeningLine /></Line>
        <Line number={2} kind="deletion"><FieldLine name="runtime" value={"\"local\""} /></Line>
        <Line number={3} kind="deletion"><FieldLine name="branch" value={"\"main\""} /></Line>
        <Line number={4} kind="deletion"><FieldLine name="agents" value="2" numeric /></Line>
        <Line number={5} kind="context"><span className="text-foreground">{"};"}</span></Line>
      </div>
      <div className="flex min-w-0 flex-col overflow-hidden border-l border-border-light">
        <Line number={1} kind="context"><OpeningLine /></Line>
        <Line number={2} kind="addition"><FieldLine name="runtime" value={"\"cloud\""} /></Line>
        <Line number={3} kind="addition"><FieldLine name="branch" value={"\"pablo/ui\""} /></Line>
        <Line number={4} kind="addition"><FieldLine name="agents" value="4" numeric /></Line>
        <Line number={5} kind="context"><span className="text-foreground">{"};"}</span></Line>
      </div>
    </div>
  );
}
