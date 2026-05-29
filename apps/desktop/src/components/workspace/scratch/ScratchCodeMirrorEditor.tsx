import { forwardRef, useImperativeHandle, useRef } from "react";
import { useScratchCodeMirrorEditor } from "@/hooks/workspaces/lifecycle/use-scratch-codemirror-editor";

export interface ScratchCodeMirrorEditorHandle {
  insertChecklistItem: () => boolean;
}

interface ScratchCodeMirrorEditorProps {
  value: string;
  placeholder: string;
  disabled: boolean;
  wordWrap: boolean;
  onChange: (value: string) => void;
  onBlur: () => void;
}

export const ScratchCodeMirrorEditor = forwardRef<
  ScratchCodeMirrorEditorHandle,
  ScratchCodeMirrorEditorProps
>(function ScratchCodeMirrorEditor({
  value,
  placeholder,
  disabled,
  wordWrap,
  onChange,
  onBlur,
}: ScratchCodeMirrorEditorProps, ref) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  const editor = useScratchCodeMirrorEditor({
    hostRef,
    value,
    placeholderText: placeholder,
    disabled,
    wordWrap,
    onChange,
    onBlur,
  });

  useImperativeHandle(ref, () => ({
    insertChecklistItem: () => editor.insertTextAtSelection("- [ ] ", {
      ensureLineStart: true,
    }),
  }), [editor]);

  return (
    <div
      ref={hostRef}
      aria-label="Scratch"
      className="h-full min-h-0 min-w-0"
      data-testid="scratch-codemirror-editor"
    />
  );
});
