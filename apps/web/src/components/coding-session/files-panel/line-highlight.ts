"use client";

import { StateEffect, StateField } from "@codemirror/state";
import {
	Decoration,
	type DecorationSet,
	EditorView,
	ViewPlugin,
	type ViewUpdate,
} from "@codemirror/view";

type HighlightedRange = {
	startLine: number;
	endLine: number;
} | null;

const setHighlightedRange = StateEffect.define<HighlightedRange>();

const highlightedRangeField = StateField.define<HighlightedRange>({
	create() {
		return null;
	},
	update(value, tr) {
		for (const effect of tr.effects) {
			if (effect.is(setHighlightedRange)) return effect.value;
		}
		return value;
	},
});

const highlightedLineDecoration = Decoration.line({
	attributes: {
		style: "background-color: hsl(var(--accent) / 0.35); border-left: 2px solid hsl(var(--ring));",
	},
});

const highlightedRangePlugin = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;

		constructor(view: EditorView) {
			this.decorations = this.getDecorations(view);
		}

		update(update: ViewUpdate) {
			if (
				update.startState.field(highlightedRangeField) !== update.state.field(highlightedRangeField)
			) {
				this.decorations = this.getDecorations(update.view);
			}
		}

		private getDecorations(view: EditorView): DecorationSet {
			const highlightedRange = view.state.field(highlightedRangeField);
			if (!highlightedRange) return Decoration.none;

			const startLine = Math.max(1, highlightedRange.startLine);
			const endLine = Math.max(startLine, highlightedRange.endLine);
			const ranges: { from: number; to: number; value: Decoration }[] = [];

			for (let line = startLine; line <= endLine; line++) {
				if (line > view.state.doc.lines) break;
				const lineInfo = view.state.doc.line(line);
				ranges.push({ from: lineInfo.from, to: lineInfo.from, value: highlightedLineDecoration });
			}

			return Decoration.set(ranges);
		}
	},
	{
		decorations: (pluginValue) => pluginValue.decorations,
	},
);

export const filesEditorLineHighlightExtension = [highlightedRangeField, highlightedRangePlugin];

export function highlightLineRangeAndScroll(view: EditorView, startLine: number, endLine?: number) {
	const normalizedStart = Math.max(1, startLine);
	const normalizedEnd = Math.max(normalizedStart, endLine ?? startLine);

	const targetLine = view.state.doc.line(Math.min(normalizedStart, view.state.doc.lines));
	const centerLine = view.state.doc.line(
		Math.min(Math.floor((normalizedStart + normalizedEnd) / 2), view.state.doc.lines),
	);

	view.dispatch({
		effects: [setHighlightedRange.of({ startLine: normalizedStart, endLine: normalizedEnd })],
		selection: { anchor: targetLine.from },
		scrollIntoView: true,
	});
	view.dispatch({
		effects: [EditorView.scrollIntoView(centerLine.from, { y: "center" })],
	});
}

export function clearLineRangeHighlight(view: EditorView) {
	view.dispatch({ effects: [setHighlightedRange.of(null)] });
}
