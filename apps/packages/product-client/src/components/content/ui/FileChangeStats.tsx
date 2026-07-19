interface FileChangeStatsProps {
  additions: number;
  deletions: number;
  className?: string;
  /** Keep activity-row counts neutral until their parent row is hovered/focused. */
  tone?: "semantic" | "activity";
  /** Match Codex completion cards by rolling changed digits between values. */
  rolling?: boolean;
}

export function FileChangeStats({
  additions,
  deletions,
  className,
  tone = "semantic",
  rolling = false,
}: FileChangeStatsProps) {
  if (!additions && !deletions) {
    return null;
  }

  return (
    <span
      data-thread-find-skip="true"
      className={`inline-flex shrink-0 items-baseline gap-1 tabular-nums tracking-tight [font-feature-settings:'cv01'_on,'cv02'_on] ${className ?? ""}`}
    >
      {additions > 0 && (
        <FileChangeStat
          sign="+"
          value={additions}
          rolling={rolling}
          className={tone === "activity"
            ? "text-inherit transition-colors group-hover/action-row:text-git-green group-focus-within/action-row:text-git-green"
            : "text-git-green"}
        />
      )}
      {deletions > 0 && (
        <FileChangeStat
          sign="-"
          value={deletions}
          rolling={rolling}
          className={tone === "activity"
            ? "text-inherit transition-colors group-hover/action-row:text-git-red group-focus-within/action-row:text-git-red"
            : "text-git-red"}
        />
      )}
    </span>
  );
}

function FileChangeStat({
  sign,
  value,
  rolling,
  className,
}: {
  sign: "+" | "-";
  value: number;
  rolling: boolean;
  className: string;
}) {
  return (
    <span className={`flex shrink-0 items-center leading-none ${className}`}>
      {sign}
      {rolling ? <RollingStatNumber value={value} /> : value}
    </span>
  );
}

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;
const DIGIT_STACK_CLASSES = [
  "diff-stat-digit-stack-0",
  "diff-stat-digit-stack-1",
  "diff-stat-digit-stack-2",
  "diff-stat-digit-stack-3",
  "diff-stat-digit-stack-4",
  "diff-stat-digit-stack-5",
  "diff-stat-digit-stack-6",
  "diff-stat-digit-stack-7",
  "diff-stat-digit-stack-8",
  "diff-stat-digit-stack-9",
] as const;

function RollingStatNumber({ value }: { value: number }) {
  const formatted = String(Math.max(0, Math.trunc(value)));
  const digits = Array.from(formatted);
  let remainingDigits = digits.length;

  return (
    <span aria-label={formatted} className="diff-stat-rolling-number">
      {digits.map((digit, index) => {
        remainingDigits -= 1;
        return (
          <RollingStatDigit
            key={`digit-${remainingDigits}`}
            digit={digit}
            fallbackKey={index}
          />
        );
      })}
    </span>
  );
}

function RollingStatDigit({
  digit,
  fallbackKey,
}: {
  digit: string;
  fallbackKey: number;
}) {
  const digitIndex = Number.parseInt(digit, 10);
  const stackClass = DIGIT_STACK_CLASSES[digitIndex]
    ?? DIGIT_STACK_CLASSES[fallbackKey % DIGIT_STACK_CLASSES.length];

  return (
    <span aria-hidden="true" className="diff-stat-digit-column">
      <span className="diff-stat-digit-clip">
        <span className={`diff-stat-digit-stack ${stackClass}`}>
          {DIGITS.map((candidate) => <span key={candidate}>{candidate}</span>)}
        </span>
      </span>
    </span>
  );
}
