import {
  createContext,
  useContext,
  type ReactNode,
} from "react";

export type TranscriptActivityDensity = "normal" | "compact";

const TranscriptActivityDensityContext = createContext<TranscriptActivityDensity>("normal");

export function TranscriptActivityDensityProvider({
  children,
  density,
}: {
  children: ReactNode;
  density: TranscriptActivityDensity;
}) {
  return (
    <TranscriptActivityDensityContext.Provider value={density}>
      {children}
    </TranscriptActivityDensityContext.Provider>
  );
}

export function TranscriptActivityBlock({
  children,
  density,
}: {
  children: ReactNode;
  density?: TranscriptActivityDensity;
}) {
  const inheritedDensity = useContext(TranscriptActivityDensityContext);
  const resolvedDensity = density ?? inheritedDensity;
  return (
    <div
      data-transcript-activity-shell
      data-transcript-activity-block
      data-transcript-activity-density={resolvedDensity}
      className="pt-1 pb-2"
    >
      {children}
    </div>
  );
}
