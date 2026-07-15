interface FileChangeStatsProps {
  additions: number;
  deletions: number;
  className?: string;
}

export function FileChangeStats({
  additions,
  deletions,
  className,
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
        <FileChangeStat sign="+" value={additions} className="text-git-green" />
      )}
      {deletions > 0 && (
        <FileChangeStat sign="-" value={deletions} className="text-git-red" />
      )}
    </span>
  );
}

function FileChangeStat({
  sign,
  value,
  className,
}: {
  sign: "+" | "-";
  value: number;
  className: string;
}) {
  return (
    <span className={`shrink-0 leading-none ${className}`}>
      {sign}
      {value}
    </span>
  );
}
