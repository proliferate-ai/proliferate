import { StatusDot, type StatusDotTone } from "#product/primitives/StatusDot";
import type { LibraryEntry } from "./types";

const TONES: StatusDotTone[] = [
  "success",
  "info",
  "warning",
  "danger",
  "muted",
  "merged",
];

function StatusDotDemo() {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        {TONES.map((tone) => (
          <StatusDot key={tone} tone={tone} label={tone} title={tone} />
        ))}
        <span className="text-info">
          <StatusDot tone="current" label="current" title="current" />
        </span>
      </div>
      <div className="flex items-center gap-3">
        {TONES.map((tone) => (
          <StatusDot
            key={tone}
            tone={tone}
            fill="hollow"
            label={`${tone} hollow`}
            title={`${tone} hollow`}
          />
        ))}
        <span className="text-info">
          <StatusDot tone="current" fill="hollow" label="current hollow" title="current hollow" />
        </span>
      </div>
    </div>
  );
}

/**
 * Registry row for `StatusDot`, kept in its own file so the vocabulary PR's
 * authors do not all edit `primitives.tsx`. The integrator splices
 * `STATUS_DOT_ENTRY` into `PRIMITIVES_ENTRIES` in alphabetical position.
 */
export const STATUS_DOT_ENTRY: LibraryEntry = {
  name: "StatusDot",
  subpath: "#product/primitives/StatusDot",
  render: StatusDotDemo,
};
