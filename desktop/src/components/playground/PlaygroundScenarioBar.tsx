import { Link } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { SCENARIOS, type ScenarioKey } from "@/config/playground";

interface PlaygroundScenarioBarProps {
  scenario: ScenarioKey;
  onSelect: (key: ScenarioKey) => void;
}

export function PlaygroundScenarioBar({ scenario, onSelect }: PlaygroundScenarioBarProps) {
  return (
    <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
      <div className="mr-3 text-sm font-semibold">Chat UI playground</div>
      <Link
        to="/"
        className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        ← Back to app
      </Link>
      <div className="mx-3 h-5 w-px bg-border" />
      {(Object.keys(SCENARIOS) as ScenarioKey[]).map((key) => {
        const active = scenario === key;
        return (
          <Button
            key={key}
            type="button"
            variant={active ? "inverted" : "secondary"}
            size="sm"
            onClick={() => onSelect(key)}
            className="text-xs font-medium"
          >
            {SCENARIOS[key].label}
          </Button>
        );
      })}
    </header>
  );
}
