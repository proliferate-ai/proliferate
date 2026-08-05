import { useNavigate } from "react-router-dom";
import { PageHeader } from "@proliferate/ui/patterns/PageHeader";
import { ListRow } from "@proliferate/ui/patterns/ListRow";
import { ArrowRight } from "@proliferate/ui/icons";

interface PlaygroundDestination {
  title: string;
  path: string;
  description: string;
}

// Front door to every dev-only playground route. Each row is a direct
// destination — no nesting, no grouping — so a new playground route only
// needs one entry here plus its App.tsx DEV-guarded route.
const DESTINATIONS: PlaygroundDestination[] = [
  {
    title: "Component library",
    path: "/playground/library",
    description: "Spec sheet of every sanctioned UI component and ProductClient pattern, tier by tier.",
  },
  {
    title: "Chat",
    path: "/playground/chat",
    description: "Chat scenario gallery — fixture states plus recorded-session replay.",
  },
  {
    title: "Updates",
    path: "/playground/updates",
    description: "Update lifecycle UI: toast, restart dialog, and download states.",
  },
  {
    title: "Workspace status",
    path: "/playground/workspace-status",
    description: "Sidebar workspace row states — git status, PR badges, attention dots.",
  },
  {
    title: "Git review",
    path: "/playground/git-review",
    description: "Git review v2 surfaces — diff viewer, review actions, file tree.",
  },
  {
    title: "Auth",
    path: "/playground/auth",
    description: "Auth/onboarding screen states — sign-in, session check, cross-fade.",
  },
  {
    title: "Agents",
    path: "/playground/agents",
    description: "Agent settings mockbed — harness and API-key panes, cloud/local surfaces.",
  },
  {
    title: "Subagents",
    path: "/playground/subagents",
    description: "Subagent UX flows — popover pane, navigation close, identity receipts.",
  },
  {
    title: "Crash recovery",
    path: "/playground/crash-recovery",
    description: "Deterministic render-crash states for the app error boundary.",
  },
];

/** Dev-only front door: every playground destination, one row each. */
export function PlaygroundIndex() {
  const navigate = useNavigate();

  return (
    <div className="flex h-screen flex-col overflow-y-auto bg-background text-foreground">
      <PageHeader
        title="Playground"
        description="Dev-only surfaces for exercising product UI outside the authenticated app. import.meta.env.DEV only."
      />
      <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6">
        <div className="rounded-lg border border-border">
          {DESTINATIONS.map((destination) => (
            <ListRow
              key={destination.path}
              title={destination.title}
              description={(
                <>
                  <code className="font-mono text-ui-sm">{destination.path}</code>
                  <span className="mx-1.5">·</span>
                  {destination.description}
                </>
              )}
              trailing={<ArrowRight className="icon-paired text-muted-foreground" />}
              onClick={() => navigate(destination.path)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
