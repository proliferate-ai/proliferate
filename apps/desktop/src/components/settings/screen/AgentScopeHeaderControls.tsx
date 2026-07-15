import { Cloud, Laptop } from "lucide-react";
import { SegmentedControl } from "@proliferate/ui/primitives/SegmentedControl";
import { useAgentSurfaceStore } from "@/stores/ui/agent-surface-store";

/**
 * Right slot of the settings scope-tab bar, Agents scope only: the Cloud|Local
 * surface toggle (design-system Bench repo header slot). Mirrors the repo
 * scope's Cloud|Local context toggle for visual parity.
 */
export function AgentScopeHeaderControls() {
  const surface = useAgentSurfaceStore((state) => state.surface);
  const setSurface = useAgentSurfaceStore((state) => state.setSurface);

  return (
    <SegmentedControl
      ariaLabel="Agent authentication surface"
      value={surface}
      items={[
        { id: "cloud", label: "Cloud", icon: <Cloud /> },
        { id: "local", label: "Local", icon: <Laptop /> },
      ]}
      onChange={setSurface}
    />
  );
}
