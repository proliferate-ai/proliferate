import { useEffect, useRef, type ReactNode } from "react";
import {
  AccountPasswordCredentialRow,
  Badge,
  Button,
  ProviderBrandIcon,
} from "@proliferate/ui";

const noop = () => {};

/** The rounded surface AccountSettingsPane stacks its sign-in rows inside. */
const MethodsSurface = ({ children }: { children: ReactNode }) => (
  <div className="w-full max-w-2xl overflow-clip rounded-lg bg-surface-elevated-secondary">
    {children}
  </div>
);

/** A sibling provider row, so the shared row rhythm and divider are visible. */
const GitHubRow = () => (
  <div className="flex items-center justify-between gap-2 border-b border-border-light px-4 py-4 text-body">
    <div className="flex min-w-0 items-center gap-3">
      <ProviderBrandIcon
        provider="github"
        className="icon-control shrink-0 text-muted-foreground"
      />
      <div className="min-w-0">
        <div className="font-medium text-foreground">GitHub</div>
        <div className="truncate text-muted-foreground">@pablo-hansen</div>
      </div>
    </div>
    <div className="flex shrink-0 items-center gap-2">
      <Badge tone="success">Connected</Badge>
      <Button type="button" variant="secondary" size="sm">
        Reconnect
      </Button>
    </div>
  </div>
);

const ExpandOnMount = ({ children }: { children: ReactNode }) => {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      host.current?.querySelector("button")?.click();
    }, 60);
    return () => window.clearTimeout(timer);
  }, []);
  return <div ref={host}>{children}</div>;
};

export const LastRowInMethodsCard = () => (
  <MethodsSurface>
    <GitHubRow />
    <AccountPasswordCredentialRow
      credential={{
        enabled: true,
        setAt: "2026-05-14T09:12:00.000Z",
        onSubmit: noop,
      }}
    />
  </MethodsSurface>
);

export const NotSetYet = () => (
  <MethodsSurface>
    <AccountPasswordCredentialRow
      credential={{ enabled: false, setAt: null, onSubmit: noop }}
    />
  </MethodsSurface>
);

export const SetPasswordForm = () => (
  <MethodsSurface>
    <ExpandOnMount>
      <AccountPasswordCredentialRow
        credential={{ enabled: false, setAt: null, onSubmit: noop }}
      />
    </ExpandOnMount>
  </MethodsSurface>
);

export const ReadOnlyNoHandler = () => (
  <MethodsSurface>
    <AccountPasswordCredentialRow credential={{ enabled: true }} />
  </MethodsSurface>
);
