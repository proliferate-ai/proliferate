import { forwardRef, type TextareaHTMLAttributes } from "react";
import { twMerge } from "#product/primitives/utils/tw-merge";

type TextareaVariant = "default" | "ghost" | "flush";
type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;
interface TextareaPropsWithVariant extends TextareaProps {
  variant?: TextareaVariant;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaPropsWithVariant>(
  function Textarea({ className = "", variant = "default", ...props }: TextareaPropsWithVariant, ref) {
    const base = variant === "ghost"
      ? "w-full resize-none border-none bg-transparent px-0 py-0 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-0 disabled:opacity-60"
      : variant === "flush"
        ? "w-full resize-none rounded-none border-0 bg-transparent px-3 py-2 text-ui text-foreground placeholder:text-muted-foreground transition-colors focus:outline-none focus:ring-1 focus:ring-inset focus:ring-ring disabled:opacity-60"
        : "w-full resize-none rounded-md border border-input bg-surface-control px-3 py-2 text-ui text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60";

    return (
      <textarea ref={ref} className={twMerge(base, className)} {...props} />
    );
  },
);
