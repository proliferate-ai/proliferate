import { useMemo, useState } from "react";
import type { WorkflowArgSpec } from "@proliferate/product-domain/workflows/definition";
import type { WorkflowTargetMode } from "@proliferate/product-domain/workflows/model";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@proliferate/ui/primitives/Label";
import { ModalShell } from "@proliferate/ui/primitives/ModalShell";
import { Select } from "@proliferate/ui/primitives/Select";
import { Switch } from "@proliferate/ui/primitives/Switch";

type TargetMode = WorkflowTargetMode;
type ArgValue = string | number | boolean;

/** A selectable run target (a local runtime workspace, or a cloud workspace). */
export interface WorkflowRunTargetOption {
  id: string;
  label: string;
}

export interface WorkflowRunSubmit {
  args: Record<string, ArgValue>;
  targetMode: TargetMode;
  localWorkspaceId?: string;
  cloudWorkspaceId?: string;
}

export interface WorkflowRunArgsModalProps {
  open: boolean;
  workflowName: string;
  args: readonly WorkflowArgSpec[];
  localWorkspaces: readonly WorkflowRunTargetOption[];
  cloudWorkspaces: readonly WorkflowRunTargetOption[];
  /** Default local workspace (e.g. the currently-open one), if any. */
  defaultLocalWorkspaceId?: string | null;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (input: WorkflowRunSubmit) => void;
}

function initialValue(arg: WorkflowArgSpec): ArgValue {
  if (arg.default !== undefined) {
    return arg.default;
  }
  switch (arg.type) {
    case "boolean":
      return false;
    case "number":
      return "" as unknown as number;
    case "enum":
      return arg.enum?.[0] ?? "";
    case "string":
      return "";
  }
}

/** Args form + run-target selection shown before a run (spec 3.2 / 3.6). */
export function WorkflowRunArgsModal({
  open,
  workflowName,
  args,
  localWorkspaces,
  cloudWorkspaces,
  defaultLocalWorkspaceId,
  busy = false,
  error = null,
  onClose,
  onSubmit,
}: WorkflowRunArgsModalProps) {
  const initial = useMemo(() => {
    const map: Record<string, ArgValue> = {};
    for (const arg of args) {
      map[arg.name] = initialValue(arg);
    }
    return map;
  }, [args]);

  const cloudAvailable = cloudWorkspaces.length > 0;

  const [values, setValues] = useState<Record<string, ArgValue>>(initial);
  const [targetMode, setTargetMode] = useState<TargetMode>("local");
  const [localWorkspaceId, setLocalWorkspaceId] = useState<string>(
    () =>
      (defaultLocalWorkspaceId
        && localWorkspaces.some((w) => w.id === defaultLocalWorkspaceId)
        ? defaultLocalWorkspaceId
        : localWorkspaces[0]?.id) ?? "",
  );
  const [cloudWorkspaceId, setCloudWorkspaceId] = useState<string>(
    () => cloudWorkspaces[0]?.id ?? "",
  );

  const setValue = (name: string, value: ArgValue) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  };

  const missingRequired = args.some(
    (arg) => arg.required && (values[arg.name] === "" || values[arg.name] === undefined),
  );
  const missingTarget =
    targetMode === "local" ? localWorkspaceId === "" : cloudWorkspaceId === "";

  const handleSubmit = () => {
    const resolved: Record<string, ArgValue> = {};
    for (const arg of args) {
      const value = values[arg.name];
      if (value === "" || value === undefined) {
        continue;
      }
      resolved[arg.name] = arg.type === "number" ? Number(value) : value;
    }
    onSubmit({
      args: resolved,
      targetMode,
      localWorkspaceId: targetMode === "local" ? localWorkspaceId : undefined,
      cloudWorkspaceId: targetMode === "personal_cloud" ? cloudWorkspaceId : undefined,
    });
  };

  const targetOptions =
    targetMode === "local" ? localWorkspaces : cloudWorkspaces;

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={`Run ${workflowName}`}
      sizeClassName="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} loading={busy} disabled={missingRequired || missingTarget}>
            Run
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-ui-sm text-destructive">
            {error}
          </p>
        ) : null}

        {args.map((arg) => (
          <div key={arg.name} className="flex flex-col gap-1.5">
            <Label className="flex items-center gap-1">
              {arg.name}
              {arg.required ? <span className="text-destructive">*</span> : null}
              <span className="text-xs font-normal text-faint">· {arg.type}</span>
            </Label>
            {arg.type === "boolean" ? (
              <Switch
                checked={Boolean(values[arg.name])}
                onChange={(checked) => setValue(arg.name, checked)}
              />
            ) : arg.type === "enum" ? (
              <Select
                value={String(values[arg.name] ?? "")}
                onChange={(event) => setValue(arg.name, event.target.value)}
              >
                {(arg.enum ?? []).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                type={arg.type === "number" ? "number" : "text"}
                value={String(values[arg.name] ?? "")}
                onChange={(event) => setValue(arg.name, event.target.value)}
                placeholder={arg.required ? "Required" : "Optional"}
              />
            )}
          </div>
        ))}

        <div className="flex flex-col gap-1.5 border-t border-border/60 pt-3">
          <Label>Run location</Label>
          <Select
            value={targetMode}
            onChange={(event) => setTargetMode(event.target.value as TargetMode)}
          >
            <option value="local">On this Mac</option>
            {cloudAvailable ? <option value="personal_cloud">Cloud</option> : null}
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Workspace</Label>
          {targetOptions.length > 0 ? (
            <Select
              value={targetMode === "local" ? localWorkspaceId : cloudWorkspaceId}
              onChange={(event) =>
                targetMode === "local"
                  ? setLocalWorkspaceId(event.target.value)
                  : setCloudWorkspaceId(event.target.value)
              }
            >
              {targetOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </Select>
          ) : (
            <p className="text-ui-sm text-faint">
              {targetMode === "local"
                ? "No local workspaces yet — open one first."
                : "No cloud workspaces yet."}
            </p>
          )}
        </div>
      </div>
    </ModalShell>
  );
}
