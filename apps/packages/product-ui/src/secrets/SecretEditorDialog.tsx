import { type FormEvent, useEffect, useMemo, useState } from "react";

import { Check, ChevronDown, CloudUpload } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@proliferate/ui/primitives/Label";
import { ModalShell } from "@proliferate/ui/primitives/ModalShell";
import { POPOVER_SURFACE_CLASS, PopoverButton } from "@proliferate/ui/primitives/PopoverButton";
import { PopoverMenuItem } from "@proliferate/ui/primitives/PopoverMenuItem";
import { Textarea } from "@proliferate/ui/primitives/Textarea";

export type SecretEditorKind = "env" | "file";
export type SecretFilePathMode = "absolute" | "relative";

export interface SecretEditorDialogState {
  mode: "create" | "edit";
  kind: SecretEditorKind;
  nameOrPath?: string;
}

export interface SecretEditorDialogProps {
  open: boolean;
  state: SecretEditorDialogState | null;
  filePathMode: SecretFilePathMode;
  saving?: boolean;
  error?: string | null;
  onClose: () => void;
  onSave: (input: SecretEditorSaveInput) => void;
}

export type SecretEditorSaveInput =
  | { kind: "env"; nameOrPath: string; secret: string }
  | { kind: "file"; nameOrPath: string; file: File };

const SECRET_KIND_LABELS: Record<SecretEditorKind, string> = {
  env: "Environment variable",
  file: "File",
};

const SECRET_KIND_OPTIONS: readonly SecretEditorKind[] = ["env", "file"];

export function SecretEditorDialog({
  open,
  state,
  filePathMode,
  saving = false,
  error = null,
  onClose,
  onSave,
}: SecretEditorDialogProps) {
  const [kind, setKind] = useState<SecretEditorKind>("env");
  const [nameOrPath, setNameOrPath] = useState("");
  const [secret, setSecret] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  useEffect(() => {
    if (!open || !state) {
      return;
    }
    setKind(state.kind);
    setNameOrPath(state.nameOrPath ?? "");
    setSecret("");
    setSelectedFile(null);
  }, [open, state]);

  const editing = state?.mode === "edit";
  const title = editing ? "Update secret" : "Add secret";
  const pathLabel = filePathMode === "absolute" ? "Absolute path" : "Repo-relative path";
  const nameLabel = kind === "env" ? "Variable name" : pathLabel;
  const hasSecretValue = kind === "env" ? secret.length > 0 : selectedFile !== null;
  const canSave = nameOrPath.trim().length > 0 && hasSecretValue && !saving;
  const description = useMemo(() => {
    if (kind === "env") {
      return "Values are stored encrypted and shown only as metadata after saving.";
    }
    return filePathMode === "absolute"
      ? "File secrets are written to absolute paths in the cloud sandbox."
      : "Workspace file secrets are written relative to this repo root.";
  }, [filePathMode, kind]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave) {
      return;
    }
    if (kind === "env") {
      onSave({ kind, nameOrPath: nameOrPath.trim(), secret });
      return;
    }
    if (selectedFile) {
      onSave({ kind, nameOrPath: nameOrPath.trim(), file: selectedFile });
    }
  }

  function handleKindChange(nextKind: SecretEditorKind) {
    setKind(nextKind);
    setSecret("");
    setSelectedFile(null);
  }

  function handleFileChange(file: File | null) {
    setSelectedFile(file);
    if (file && filePathMode === "relative" && nameOrPath.trim().length === 0) {
      setNameOrPath(file.name);
    }
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      disableClose={saving}
      telemetryBlocked
      title={title}
      description={description}
      sizeClassName="max-w-xl"
      footer={(
        <>
          <Button type="button" variant="ghost" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="secret-editor-form" loading={saving} disabled={!canSave}>
            Save
          </Button>
        </>
      )}
    >
      <form id="secret-editor-form" className="space-y-4" onSubmit={submit}>
        {editing ? null : (
          <div className="space-y-1.5">
            <Label className="mb-0 text-sm font-medium text-foreground">Type</Label>
            <SecretKindSelect value={kind} onChange={handleKindChange} />
          </div>
        )}
        <Label className="block space-y-1.5 text-sm font-medium text-foreground">
          <span className="block">{nameLabel}</span>
          <Input
            value={nameOrPath}
            disabled={editing}
            placeholder={kind === "env" ? "API_TOKEN" : filePathMode === "absolute" ? "/home/user/.env" : ".env.local"}
            onChange={(event) => setNameOrPath(event.currentTarget.value)}
          />
        </Label>
        {kind === "env" ? (
          <Label className="block space-y-1.5 text-sm font-medium text-foreground">
            <span className="block">Value</span>
            <Textarea
              value={secret}
              data-telemetry-mask
              className="h-36 font-mono text-sm"
              placeholder={editing ? "Replacement secret" : "Secret value"}
              onChange={(event) => setSecret(event.currentTarget.value)}
            />
          </Label>
        ) : (
          <Label className="block space-y-1.5 text-sm font-medium text-foreground">
            <span className="block">Upload file</span>
            <div className="flex flex-col gap-2 rounded-md border border-input bg-surface-control p-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CloudUpload className="size-4 shrink-0" />
                <span className="min-w-0 truncate">
                  {selectedFile
                    ? `${selectedFile.name} · ${formatBytes(selectedFile.size)}`
                    : "Choose a UTF-8 text file to upload."}
                </span>
              </div>
              <Input
                type="file"
                data-telemetry-mask
                className="h-auto cursor-pointer py-2"
                onChange={(event) => handleFileChange(event.currentTarget.files?.[0] ?? null)}
              />
            </div>
          </Label>
        )}
        {error ? (
          <div className="rounded-md border border-destructive/25 bg-destructive-subtle px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}
      </form>
    </ModalShell>
  );
}

function SecretKindSelect({
  value,
  onChange,
}: {
  value: SecretEditorKind;
  onChange: (value: SecretEditorKind) => void;
}) {
  return (
    <PopoverButton
      align="start"
      side="bottom"
      className={`w-[min(32rem,calc(100vw-2rem))] ${POPOVER_SURFACE_CLASS}`}
      trigger={(
        <Button
          type="button"
          variant="outline"
          size="md"
          className="h-9 w-full justify-between rounded-md border-input bg-surface-control px-3 text-sm font-normal text-foreground shadow-none hover:bg-list-hover data-[state=open]:ring-1 data-[state=open]:ring-ring"
        >
          <span className="min-w-0 truncate text-left">{SECRET_KIND_LABELS[value]}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      )}
    >
      {(close) => (
        <div className="max-h-64 overflow-y-auto">
          {SECRET_KIND_OPTIONS.map((option) => {
            const selected = option === value;
            return (
              <PopoverMenuItem
                key={option}
                label={SECRET_KIND_LABELS[option]}
                trailing={selected ? <Check className="size-3.5" /> : <span className="size-3.5" />}
                aria-selected={selected}
                role="option"
                onClick={() => {
                  onChange(option);
                  close();
                }}
              />
            );
          })}
        </div>
      )}
    </PopoverButton>
  );
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} bytes`;
  }
  const kib = value / 1024;
  if (kib < 1024) {
    return `${kib.toFixed(kib >= 10 ? 0 : 1)} KiB`;
  }
  const mib = kib / 1024;
  return `${mib.toFixed(mib >= 10 ? 0 : 1)} MiB`;
}
