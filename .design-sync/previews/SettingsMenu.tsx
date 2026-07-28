import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ClaudeSparkle,
  Robot,
  SettingsMenu,
  SettingsRow,
  SquareTerminal,
} from "@proliferate/ui";

/**
 * The menu surface only exists while the popover is open, and the trigger has
 * no `open` prop — so this wrapper clicks the trigger once on mount to capture
 * the opened state. Nothing else in the cell depends on it.
 */
function OpenOnMount({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      ref.current?.querySelector("button")?.click();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  // The menu is portalled and lands just under the trigger, so the trigger
  // sits low enough here that both it and the open surface stay in frame.
  return <div ref={ref} className="pb-64 pt-2">{children}</div>;
}

/**
 * `leading` lands directly in the trigger button, which does not size its own
 * slot — the consumer supplies the icon class (the product passes
 * `icon-paired` here too).
 */
const HARNESS_OPTIONS = [
  {
    id: "claude-code",
    label: "Claude Code",
    detail: "claude-sonnet-4-5",
    icon: <ClaudeSparkle className="icon-paired" />,
  },
  {
    id: "codex",
    label: "Codex",
    detail: "gpt-5-codex",
    icon: <Robot className="icon-paired" />,
  },
  {
    id: "opencode",
    label: "OpenCode",
    detail: "bring your own key",
    icon: <SquareTerminal className="icon-paired" />,
  },
];

export const Trigger = () => {
  const [harness, setHarness] = useState("claude-code");
  const current = HARNESS_OPTIONS.find((option) => option.id === harness);
  return (
    <SettingsMenu
      label={current ? current.label : "Select a harness"}
      leading={current ? current.icon : undefined}
      groups={[
        {
          id: "harness",
          options: HARNESS_OPTIONS.map((option) => ({
            id: option.id,
            label: option.label,
            detail: option.detail,
            icon: option.icon,
            selected: option.id === harness,
            onSelect: () => setHarness(option.id),
          })),
        },
      ]}
    />
  );
};

export const InSettingsRows = () => {
  const [target, setTarget] = useState("vscode");
  const [prefix, setPrefix] = useState("username");
  return (
    <div className="flex w-full max-w-2xl flex-col">
      <SettingsRow
        label="Open in"
        description="Which editor the Open in action launches."
      >
        <SettingsMenu
          label={target === "vscode" ? "Visual Studio Code" : "Cursor"}
          className="w-60"
          menuClassName="w-60"
          groups={[
            {
              id: "targets",
              options: [
                {
                  id: "vscode",
                  label: "Visual Studio Code",
                  selected: target === "vscode",
                  onSelect: () => setTarget("vscode"),
                },
                {
                  id: "cursor",
                  label: "Cursor",
                  selected: target === "cursor",
                  onSelect: () => setTarget("cursor"),
                },
              ],
            },
          ]}
        />
      </SettingsRow>
      <SettingsRow
        label="Branch prefix"
        description="Prefix applied to branches new workspaces create."
      >
        <SettingsMenu
          label={prefix === "username" ? "GitHub username" : "proliferate"}
          className="w-60"
          menuClassName="w-60"
          groups={[
            {
              id: "branch-prefix",
              options: [
                {
                  id: "username",
                  label: "GitHub username",
                  selected: prefix === "username",
                  onSelect: () => setPrefix("username"),
                },
                {
                  id: "fixed",
                  label: "proliferate",
                  selected: prefix === "fixed",
                  onSelect: () => setPrefix("fixed"),
                },
              ],
            },
          ]}
        />
      </SettingsRow>
    </div>
  );
};

export const Open = () => {
  const [harness, setHarness] = useState("claude-code");
  const current = HARNESS_OPTIONS.find((option) => option.id === harness);
  return (
    <OpenOnMount>
      <SettingsMenu
        label={current ? current.label : "Select a harness"}
        leading={current ? current.icon : undefined}
        groups={[
          {
            id: "installed",
            label: "Installed",
            options: HARNESS_OPTIONS.map((option) => ({
              id: option.id,
              label: option.label,
              detail: option.detail,
              icon: option.icon,
              selected: option.id === harness,
              onSelect: () => setHarness(option.id),
            })),
          },
          {
            id: "available",
            label: "Not installed",
            options: [
              {
                id: "aider",
                label: "Aider",
                detail: "Install to enable",
                disabled: true,
                onSelect: () => {},
              },
            ],
          },
        ]}
      />
    </OpenOnMount>
  );
};
