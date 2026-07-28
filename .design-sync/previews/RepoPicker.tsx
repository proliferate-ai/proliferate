import { useEffect, useRef, useState, type ReactNode } from "react";
import { RepoPicker, SegmentedControl } from "@proliferate/ui";

const REPOS = [
  {
    id: "/Users/pab/src/anyharness",
    name: "anyharness",
    detail: "proliferate/anyharness",
    kind: "local",
  },
  {
    id: "/Users/pab/src/proliferate-web",
    name: "proliferate-web",
    detail: "proliferate/proliferate-web",
    kind: "local",
  },
  {
    id: "cloud:proliferate/agent-catalog",
    name: "agent-catalog",
    detail: "Cloud environment",
    kind: "cloud",
  },
  {
    id: "cloud:proliferate/docs",
    name: "docs",
    detail: "Cloud environment",
    kind: "cloud",
  },
];

/**
 * `RepoPicker` wraps `PopoverButton`, whose open state is private and is not
 * forwarded — the only way to photograph the menu is to click the real trigger
 * on mount, which is what this host does.
 */
function OpenOnMount({ children }: { children: ReactNode }) {
  const host = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    host.current?.querySelector("button")?.click();
  }, []);
  return (
    <div ref={host} className="w-full pb-72">
      {children}
    </div>
  );
}

export const HeaderControls = () => {
  const [value, setValue] = useState(REPOS[0].id);
  const [context, setContext] = useState("cloud");
  return (
    <div className="flex h-10 w-full items-center justify-end gap-2 border-b border-border pb-2">
      <RepoPicker
        items={REPOS}
        value={value}
        onSelect={setValue}
        onAddRepository={() => undefined}
      />
      <SegmentedControl
        ariaLabel="Repository settings context"
        className="shrink-0"
        value={context}
        items={[
          { id: "cloud", label: "Cloud" },
          { id: "local", label: "Local" },
        ]}
        onChange={setContext}
      />
    </div>
  );
};

export const CloudRepoSelected = () => (
  <div className="flex w-full flex-col items-end gap-2">
    <RepoPicker
      items={REPOS}
      value="cloud:proliferate/agent-catalog"
      onSelect={() => undefined}
      onAddRepository={() => undefined}
    />
    <p className="text-ui-sm text-muted-foreground">
      A cloud environment carries the Cloud glyph; GitHub-backed checkouts carry
      the GitHub mark.
    </p>
  </div>
);

export const OpenMenu = () => (
  <OpenOnMount>
    <div className="flex w-full justify-end">
      <RepoPicker
        items={REPOS}
        value={REPOS[0].id}
        onSelect={() => undefined}
        onAddRepository={() => undefined}
      />
    </div>
  </OpenOnMount>
);

export const SingleRepository = () => (
  <div className="flex w-full justify-end">
    <RepoPicker
      items={[REPOS[0]]}
      value={null}
      onSelect={() => undefined}
      onAddRepository={() => undefined}
    />
  </div>
);
