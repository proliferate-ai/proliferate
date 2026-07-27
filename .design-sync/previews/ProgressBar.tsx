import { ProgressBar } from "@proliferate/ui";

export const Levels = () => (
  <div className="flex w-64 flex-col gap-3">
    {[15, 45, 80, 100].map((value) => (
      <div key={value} className="flex items-center gap-3">
        <ProgressBar
          value={value}
          className="h-2 w-40 overflow-hidden rounded-full bg-input"
          indicatorClassName="h-full bg-primary"
        />
        <span className="text-ui-sm text-muted-foreground">{value}%</span>
      </div>
    ))}
  </div>
);
