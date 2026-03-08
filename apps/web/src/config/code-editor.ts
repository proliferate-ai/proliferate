import { filesEditorLineHighlightExtension } from "@/components/coding-session/files-panel/line-highlight";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

export const baseExtensions: Extension[] = [
	javascript({ jsx: true, typescript: true }),
	html({ autoCloseTags: true }),
	EditorView.lineWrapping,
	filesEditorLineHighlightExtension,
];
