export function CenterMessage({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-[13px] text-muted-foreground">{message}</p>
    </div>
  );
}
