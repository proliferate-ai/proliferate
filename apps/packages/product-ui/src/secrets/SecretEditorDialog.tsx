import { type ClipboardEvent, type FormEvent, useEffect, useMemo, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import { CloudUpload } from "@proliferate/ui/icons";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@proliferate/ui/primitives/Label";
import { ModalShell } from "@proliferate/ui/primitives/ModalShell";
import { Select } from "@proliferate/ui/primitives/Select";
import { Textarea } from "@proliferate/ui/primitives/Textarea";

export type SecretEditorKind = "env" | "file";
export type SecretFileContentSource = "text" | "upload";
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
  /** Scope blurb (e.g. "Available in your cloud sandbox…") describing where the secret lives. */
  scopeDescription?: string;
  /** Existing env var names — used to flag duplicates before submit. */
  existingEnvKeys?: readonly string[];
  /** Existing file paths — used to flag duplicates before submit. */
  existingFileKeys?: readonly string[];
  saving?: boolean;
  error?: string | null;
  onClose: () => void;
  onSave: (input: SecretEditorSaveInput) => void;
}

export type SecretEditorSaveInput =
  | { kind: "env"; nameOrPath: string; secret: string }
  | { kind: "file"; nameOrPath: string; content: string }
  | { kind: "file"; nameOrPath: string; file: File };

const SECRET_KIND_LABELS: Record<SecretEditorKind, string> = {
  env: "Environment variable",
  file: "File",
};

const SECRET_KIND_OPTIONS: readonly SecretEditorKind[] = ["env", "file"];
const FILE_CONTENT_SOURCE_LABELS: Record<SecretFileContentSource, string> = {
  text: "Paste text",
  upload: "Upload file",
};
const FILE_CONTENT_SOURCE_OPTIONS: readonly SecretFileContentSource[] = ["text", "upload"];

const fieldLabelClass = "text-sm font-medium text-foreground";
const toggleClass =
  "inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function SecretEditorDialog({
  open,
  state,
  filePathMode,
  scopeDescription,
  existingEnvKeys = [],
  existingFileKeys = [],
  saving = false,
  error = null,
  onClose,
  onSave,
}: SecretEditorDialogProps) {
  const [kind, setKind] = useState<SecretEditorKind>("env");
  const [nameOrPath, setNameOrPath] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [secret, setSecret] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [multiline, setMultiline] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileContentSource, setFileContentSource] = useState<SecretFileContentSource>("text");

  useEffect(() => {
    if (!open || !state) {
      return;
    }
    setKind(state.kind);
    setNameOrPath(state.nameOrPath ?? "");
    setNameTouched(false);
    setSecret("");
    setRevealed(false);
    setMultiline(false);
    setSelectedFile(null);
    setFileContentSource("text");
  }, [open, state]);

  const editing = state?.mode === "edit";
  const trimmedName = nameOrPath.trim();
  const kindNoun = kind === "env" ? "environment variable" : "file secret";
  const title = editing ? `Edit ${kindNoun}` : `Add ${kindNoun}`;
  const pathLabel = filePathMode === "absolute" ? "Absolute path" : "Repo-relative path";
  const nameLabel = kind === "env" ? "Variable name" : pathLabel;

  const siblingKeys = kind === "env" ? existingEnvKeys : existingFileKeys;
  const duplicate = !editing && trimmedName.length > 0 && siblingKeys.includes(trimmedName);
  const nameEmptyError = nameTouched && trimmedName.length === 0;
  const nameError = duplicate
    ? `A ${kindNoun} named “${trimmedName}” already exists.`
    : nameEmptyError
      ? kind === "env"
        ? "Enter a variable name."
        : "Enter a path."
      : null;
  const nameHint = useMemo(() => {
    if (kind === "env") {
      return "Use letters, numbers and underscores, e.g. API_TOKEN.";
    }
    return filePathMode === "absolute"
      ? "Absolute path in the cloud sandbox, e.g. /home/user/.env."
      : "Path relative to this repo root, e.g. .env.local.";
  }, [filePathMode, kind]);

  const hasSecretValue =
    kind === "env" || fileContentSource === "text" ? secret.length > 0 : selectedFile !== null;
  const canSave = trimmedName.length > 0 && hasSecretValue && !duplicate && !saving;

  const description = scopeDescription
    ?? (kind === "env"
      ? "Stored encrypted in your cloud sandbox."
      : filePathMode === "absolute"
        ? "Written to an absolute path in the cloud sandbox."
        : "Written relative to this repo root.");
  const handlingNote = kind === "env"
    ? "Stored encrypted. Only the name and byte size are shown after saving."
    : "Stored encrypted and written into the sandbox when it next materializes.";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave) {
      return;
    }
    if (kind === "env") {
      onSave({ kind, nameOrPath: trimmedName, secret });
      return;
    }
    if (fileContentSource === "text") {
      onSave({ kind, nameOrPath: trimmedName, content: secret });
      return;
    }
    if (selectedFile) {
      onSave({ kind, nameOrPath: trimmedName, file: selectedFile });
    }
  }

  function handleKindChange(nextKind: SecretEditorKind) {
    setKind(nextKind);
    setSecret("");
    setRevealed(false);
    setMultiline(false);
    setSelectedFile(null);
    setFileContentSource("text");
  }

  function handleValuePaste(event: ClipboardEvent<HTMLInputElement>) {
    if (multiline) {
      return;
    }
    const pasted = event.clipboardData.getData("text");
    if (pasted.includes("\n")) {
      event.preventDefault();
      setMultiline(true);
      setSecret((prev) => prev + pasted);
    }
  }

  function handleFileChange(file: File | null) {
    setSelectedFile(file);
    if (file && filePathMode === "relative" && nameOrPath.trim().length === 0) {
      setNameOrPath(file.name);
    }
  }

  function handleFileContentSourceChange(nextSource: SecretFileContentSource) {
    setFileContentSource(nextSource);
    setSecret("");
    setSelectedFile(null);
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
            {editing ? "Save changes" : "Add secret"}
          </Button>
        </>
      )}
    >
      <form id="secret-editor-form" className="space-y-4" onSubmit={submit}>
        {editing ? null : (
          <Label className="block space-y-1.5 text-sm font-medium text-foreground">
            <span className="block">Type</span>
            <Select
              value={kind}
              onChange={(event) =>
                handleKindChange(event.currentTarget.value as SecretEditorKind)}
            >
              {SECRET_KIND_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {SECRET_KIND_LABELS[option]}
                </option>
              ))}
            </Select>
          </Label>
        )}

        <div className="space-y-1.5">
          <label htmlFor="secret-name" className={fieldLabelClass}>
            {nameLabel}
          </label>
          <Input
            id="secret-name"
            value={nameOrPath}
            disabled={editing}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={nameError ? true : undefined}
            className={`font-mono${nameError ? " border-destructive/60 focus:ring-destructive" : ""}`}
            placeholder={
              kind === "env"
                ? "API_TOKEN"
                : filePathMode === "absolute"
                  ? "/home/user/.env"
                  : ".env.local"
            }
            onChange={(event) => setNameOrPath(event.currentTarget.value)}
            onBlur={() => setNameTouched(true)}
          />
          {editing ? null : (
            <p className={`text-xs ${nameError ? "text-destructive" : "text-muted-foreground"}`}>
              {nameError ?? nameHint}
            </p>
          )}
        </div>

        {kind === "env" ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="secret-value" className={fieldLabelClass}>
                Value
              </label>
              <div className="flex items-center gap-0.5">
                {multiline ? null : (
                  <button
                    type="button"
                    className={toggleClass}
                    aria-label={revealed ? "Hide value" : "Show value"}
                    onClick={() => setRevealed((value) => !value)}
                  >
                    {revealed ? <EyeOff size={13} /> : <Eye size={13} />}
                    {revealed ? "Hide" : "Show"}
                  </button>
                )}
                <button
                  type="button"
                  className={toggleClass}
                  onClick={() => setMultiline((value) => !value)}
                >
                  {multiline ? "Single line" : "Multi-line"}
                </button>
              </div>
            </div>
            {multiline ? (
              <Textarea
                id="secret-value"
                value={secret}
                data-telemetry-mask
                autoComplete="off"
                spellCheck={false}
                className="h-36 font-mono text-sm"
                placeholder={editing ? "Replacement secret" : "Secret value"}
                onChange={(event) => setSecret(event.currentTarget.value)}
              />
            ) : (
              <Input
                id="secret-value"
                type={revealed ? "text" : "password"}
                value={secret}
                data-telemetry-mask
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
                placeholder={editing ? "Replacement secret" : "Secret value"}
                onChange={(event) => setSecret(event.currentTarget.value)}
                onPaste={handleValuePaste}
              />
            )}
          </div>
        ) : (
          <>
            <Label className="block space-y-1.5 text-sm font-medium text-foreground">
              <span className="block">Content source</span>
              <Select
                value={fileContentSource}
                onChange={(event) =>
                  handleFileContentSourceChange(
                    event.currentTarget.value as SecretFileContentSource,
                  )}
              >
                {FILE_CONTENT_SOURCE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {FILE_CONTENT_SOURCE_LABELS[option]}
                  </option>
                ))}
              </Select>
            </Label>
            {fileContentSource === "text" ? (
              <Label className="block space-y-1.5 text-sm font-medium text-foreground">
                <span className="block">File content</span>
                <Textarea
                  value={secret}
                  data-telemetry-mask
                  spellCheck={false}
                  className="h-52 font-mono text-sm"
                  placeholder={editing ? "Replacement file content" : "Secret file content"}
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
                    onChange={(event) =>
                      handleFileChange(event.currentTarget.files?.[0] ?? null)
                    }
                  />
                </div>
              </Label>
            )}
          </>
        )}

        <p className="text-xs text-muted-foreground">{handlingNote}</p>

        {error ? (
          <div className="rounded-md border border-destructive/25 bg-destructive-subtle px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}
      </form>
    </ModalShell>
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
