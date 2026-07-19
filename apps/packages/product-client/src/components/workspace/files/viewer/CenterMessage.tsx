export function CenterMessage({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-[length:var(--text-message)] leading-[var(--text-message--line-height)] text-muted-foreground">{message}</p>
    </div>
  );
}
