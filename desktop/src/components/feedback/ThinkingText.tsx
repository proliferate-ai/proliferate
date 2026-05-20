import { twMerge } from "tailwind-merge";

export function ThinkingText({
  className,
  text = "Thinking",
}: {
  className?: string;
  text?: string;
}) {
  return (
    <span
      className={twMerge("thinking-text inline-block text-sm font-medium", className)}
      data-thinking-text
    >
      {text}
    </span>
  );
}
