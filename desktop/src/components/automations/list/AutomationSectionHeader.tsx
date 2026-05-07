interface AutomationSectionHeaderProps {
  title: string;
  count?: number;
}

export function AutomationSectionHeader({
  title,
  count,
}: AutomationSectionHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/70 pb-2 pl-2 pr-0.5">
      <h3 className="text-lg font-medium leading-6 text-foreground">{title}</h3>
      {typeof count === "number" && (
        <span className="text-sm text-muted-foreground">
          {count}
        </span>
      )}
    </div>
  );
}
