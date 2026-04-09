import { forwardRef, type TextareaHTMLAttributes } from "react";

type TextareaVariant = "default" | "ghost";
type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;
interface TextareaPropsWithVariant extends TextareaProps {
  variant?: TextareaVariant;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaPropsWithVariant>(
  function Textarea({ className = "", variant = "default", ...props }: TextareaPropsWithVariant, ref) {
    const base = variant === "ghost"
      ? "w-full resize-none border-none bg-transparent px-0 py-0 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-0 disabled:opacity-60"
      : "w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60";

    return (
      <textarea ref={ref} className={`${base} ${className}`} {...props} />
    );
  },
);
