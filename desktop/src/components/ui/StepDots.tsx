interface StepDotsProps {
  count: number;
  current: number;
}

export function StepDots({ count, current }: StepDotsProps) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: count }, (_, i) => {
        const step = i + 1;
        const isComplete = step < current;
        const isCurrent = step === current;

        return (
          <div
            key={step}
            className={[
              "size-2 rounded-full transition-colors duration-200",
              isCurrent
                ? "bg-foreground"
                : isComplete
                  ? "bg-foreground/40"
                  : "bg-foreground/15",
            ].join(" ")}
          />
        );
      })}
    </div>
  );
}
