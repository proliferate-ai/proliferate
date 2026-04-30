import { forwardRef, type TextareaHTMLAttributes } from "react";
import { twMerge } from "tailwind-merge";

type TextareaVariant = "default" | "ghost" | "code";
type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;
interface TextareaPropsWithVariant extends TextareaProps {
  variant?: TextareaVariant;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaPropsWithVariant>(
  function Textarea({ className = "", variant = "default", ...props }: TextareaPropsWithVariant, ref) {
    const base = variant === "ghost"
      ? "w-full resize-none border-none bg-transparent px-0 py-0 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-0 disabled:opacity-60"
      : variant === "code"
        ? "w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-[length:var(--readable-code-font-size)] leading-[var(--readable-code-line-height)] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
        : "w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60";

    return (
      <textarea ref={ref} className={twMerge(base, className)} {...props} />
    );
  },
);
