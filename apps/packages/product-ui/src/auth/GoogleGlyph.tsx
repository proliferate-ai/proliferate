export function GoogleGlyph({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`font-semibold leading-none text-foreground ${className}`}
    >
      G
    </span>
  );
}
