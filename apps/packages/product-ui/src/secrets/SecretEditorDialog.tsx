import { type FormEvent, useEffect, useMemo, useState } from "react";

import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { ModalShell } from "@proliferate/ui/primitives/ModalShell";
import { Select } from "@proliferate/ui/primitives/Select";
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
  onSave: (input: { kind: SecretEditorKind; nameOrPath: string; secret: string }) => void;
}

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

  useEffect(() => {
    if (!open || !state) {
      return;
    }
    setKind(state.kind);
    setNameOrPath(state.nameOrPath ?? "");
    setSecret("");
  }, [open, state]);

  const editing = state?.mode === "edit";
  const title = editing ? "Update secret" : "Add secret";
  const pathLabel = filePathMode === "absolute" ? "Absolute path" : "Repo-relative path";
  const valueLabel = kind === "env" ? "Value" : "File content";
  const nameLabel = kind === "env" ? "Variable name" : pathLabel;
  const canSave = nameOrPath.trim().length > 0 && secret.length > 0 && !saving;
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
    onSave({ kind, nameOrPath: nameOrPath.trim(), secret });
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
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-foreground">Type</span>
            <Select
              value={kind}
              onChange={(event) => setKind(event.currentTarget.value as SecretEditorKind)}
            >
              <option value="env">Environment variable</option>
              <option value="file">File</option>
            </Select>
          </label>
        )}
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-foreground">{nameLabel}</span>
          <Input
            value={nameOrPath}
            disabled={editing}
            placeholder={kind === "env" ? "API_TOKEN" : filePathMode === "absolute" ? "/home/user/.env" : ".env.local"}
            onChange={(event) => setNameOrPath(event.currentTarget.value)}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-foreground">{valueLabel}</span>
          <Textarea
            value={secret}
            data-telemetry-mask
            className="h-36 font-mono text-sm"
            placeholder={editing ? "Replacement secret" : "Secret value"}
            onChange={(event) => setSecret(event.currentTarget.value)}
          />
        </label>
        {error ? (
          <div className="rounded-md border border-destructive/25 bg-destructive-subtle px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}
      </form>
    </ModalShell>
  );
}
