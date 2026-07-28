import { useState } from "react";
import { Checkbox, Label } from "@proliferate/ui";

export const States = () => (
  <div className="flex flex-col gap-3">
    <div className="flex items-center gap-2">
      <Checkbox checked />
      <span className="text-ui text-foreground">checked</span>
    </div>
    <div className="flex items-center gap-2">
      <Checkbox checked={false} />
      <span className="text-ui text-foreground">unchecked</span>
    </div>
    <div className="flex items-center gap-2">
      <Checkbox checked="indeterminate" />
      <span className="text-ui text-foreground">indeterminate</span>
    </div>
    <div className="flex items-center gap-2">
      <Checkbox checked disabled />
      <span className="text-ui text-foreground">disabled · checked</span>
    </div>
    <div className="flex items-center gap-2">
      <Checkbox checked={false} disabled />
      <span className="text-ui text-foreground">disabled · unchecked</span>
    </div>
  </div>
);

export const WithLabel = () => {
  const [checked, setChecked] = useState(true);
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id="auto-approve"
        checked={checked}
        onCheckedChange={(value) => setChecked(value === true)}
      />
      <Label htmlFor="auto-approve" className="mb-0 text-ui text-foreground">
        Auto-approve read-only tools
      </Label>
    </div>
  );
};

const PERMISSIONS = [
  { id: "read", label: "Read files", detail: "Read, Glob, Grep", initial: true },
  { id: "edit", label: "Edit files", detail: "Edit, Write, NotebookEdit", initial: true },
  { id: "bash", label: "Run shell commands", detail: "Bash — asks each time", initial: false },
  { id: "web", label: "Fetch the web", detail: "WebFetch, WebSearch", initial: false },
];

export const PermissionList = () => {
  const [granted, setGranted] = useState(() =>
    PERMISSIONS.filter((item) => item.initial).map((item) => item.id),
  );
  return (
    <div className="w-80 rounded-lg border border-border bg-surface-elevated p-3">
      <div className="text-body-emphasis text-foreground">Tool permissions</div>
      <p className="mt-1 text-ui-sm text-muted-foreground">
        Applies to every session in this workspace.
      </p>
      <div className="mt-3 flex flex-col gap-3">
        {PERMISSIONS.map((item) => (
          <div key={item.id} className="flex items-start gap-2">
            <Checkbox
              id={item.id}
              className="mt-1"
              checked={granted.includes(item.id)}
              onCheckedChange={(value) =>
                setGranted((current) =>
                  value === true
                    ? [...current, item.id]
                    : current.filter((id) => id !== item.id),
                )
              }
            />
            <div className="min-w-0">
              <Label htmlFor={item.id} className="mb-0 text-ui text-foreground">
                {item.label}
              </Label>
              <div className="text-ui-sm text-muted-foreground">{item.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
