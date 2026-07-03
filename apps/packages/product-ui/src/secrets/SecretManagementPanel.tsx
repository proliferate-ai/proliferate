import { useEffect, useMemo, useState } from "react";
import { KeyRound, Plus } from "lucide-react";

import { Badge } from "@proliferate/ui/primitives/Badge";
import { Button } from "@proliferate/ui/primitives/Button";
import { SettingsSection } from "../settings/SettingsSection";
import { SettingsRow } from "../settings/SettingsRow";
import { SecretDeleteDialog, type SecretDeleteDialogState } from "./SecretDeleteDialog";
import {
  SecretEditorDialog,
  type SecretEditorSaveInput,
  type SecretEditorDialogState,
  type SecretFilePathMode,
} from "./SecretEditorDialog";
import { SecretList, type SecretListItem } from "./SecretList";
import { SecretScopeNotice } from "./SecretScopeNotice";

export interface SecretMetadata {
  id: string;
  name?: string;
  path?: string;
  byteSize: number;
  updatedAt: string;
}

export interface SecretMaterializationView {
  status: "pending" | "running" | "ready" | "error";
  lastError: string | null;
  materializedAt: string | null;
}

export interface SecretManagementPanelProps {
  title: string;
  description: string;
  filePathMode: SecretFilePathMode;
  envVars: readonly SecretMetadata[];
  files: readonly SecretMetadata[];
  materialization?: SecretMaterializationView | null;
  canManage?: boolean;
  loading?: boolean;
  saving?: boolean;
  error?: string | null;
  onSaveEnvVar: (name: string, value: string) => void;
  onDeleteEnvVar: (name: string) => void;
  onSaveFile: (path: string, input: { content: string } | { file: File }) => void;
  onDeleteFile: (path: string) => void;
}

export function SecretManagementPanel({
  title,
  description,
  filePathMode,
  envVars,
  files,
  materialization = null,
  canManage = true,
  loading = false,
  saving = false,
  error = null,
  onSaveEnvVar,
  onDeleteEnvVar,
  onSaveFile,
  onDeleteFile,
}: SecretManagementPanelProps) {
  const [editorState, setEditorState] = useState<SecretEditorDialogState | null>(null);
  const [deleteState, setDeleteState] = useState<SecretDeleteDialogState | null>(null);
  // Keep the editor open until a submitted save settles: close on success,
  // stay open (showing the error) on failure so the user keeps their input.
  const [submitPhase, setSubmitPhase] = useState<"idle" | "submitted" | "saving">("idle");
  const envItems = useMemo(
    () => envVars.map((item) => secretMetadataToListItem(item, item.name ?? "")),
    [envVars],
  );
  const fileItems = useMemo(
    () => files.map((item) => secretMetadataToListItem(item, item.path ?? "")),
    [files],
  );
  const existingEnvKeys = useMemo(() => envItems.map((item) => item.label), [envItems]);
  const existingFileKeys = useMemo(() => fileItems.map((item) => item.label), [fileItems]);
  const status = error ? "error" : materialization?.status ?? "pending";

  function handleEditorSave(input: SecretEditorSaveInput) {
    if (input.kind === "env") {
      onSaveEnvVar(input.nameOrPath, input.secret);
    } else if ("file" in input) {
      onSaveFile(input.nameOrPath, { file: input.file });
    } else {
      onSaveFile(input.nameOrPath, { content: input.content });
    }
    setSubmitPhase("submitted");
  }

  useEffect(() => {
    if (submitPhase === "idle") {
      return;
    }
    if (saving) {
      // Wait until we've observed the in-flight save before deciding to close.
      if (submitPhase !== "saving") {
        setSubmitPhase("saving");
      }
      return;
    }
    if (submitPhase === "saving") {
      setSubmitPhase("idle");
      if (!error) {
        setEditorState(null);
      }
    }
  }, [submitPhase, saving, error]);

  function handleDeleteConfirm() {
    if (!deleteState) {
      return;
    }
    if (deleteState.kind === "env") {
      onDeleteEnvVar(deleteState.nameOrPath);
    } else {
      onDeleteFile(deleteState.nameOrPath);
    }
    setDeleteState(null);
  }

  return (
    <SettingsSection>
      <SettingsRow
        label={(
          <span className="flex items-center gap-2">
            <KeyRound size={14} className="text-muted-foreground" />
            {title}
          </span>
        )}
        description={<SecretScopeNotice description={description} />}
      >
        <div className="flex items-center gap-2">
          <Badge tone={status === "ready" ? "success" : status === "error" ? "destructive" : "warning"}>
            {statusLabel(status, loading)}
          </Badge>
          {canManage ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setEditorState({ mode: "create", kind: "env" })}
            >
              <Plus size={14} />
              Add secret
            </Button>
          ) : null}
        </div>
      </SettingsRow>

      <SettingsRow label="Environment variables" className="sm:items-start">
        <div className="w-full max-w-xl">
          <SecretList
            emptyLabel="No environment variables yet."
            emptyDescription="Add your first key to inject it into every cloud sandbox in this scope."
            addLabel="Add variable"
            onAdd={() => setEditorState({ mode: "create", kind: "env" })}
            items={envItems}
            canManage={canManage}
            onEdit={(item) => setEditorState({ mode: "edit", kind: "env", nameOrPath: item.label })}
            onDelete={(item) => setDeleteState({ kind: "env", nameOrPath: item.label })}
          />
        </div>
      </SettingsRow>

      <SettingsRow label="Files" className="sm:items-start">
        <div className="w-full max-w-xl">
          <SecretList
            emptyLabel="No file secrets yet."
            emptyDescription="Write a config or credential file straight into the sandbox filesystem."
            addLabel="Add file"
            onAdd={() => setEditorState({ mode: "create", kind: "file" })}
            items={fileItems}
            canManage={canManage}
            onEdit={(item) => setEditorState({ mode: "edit", kind: "file", nameOrPath: item.label })}
            onDelete={(item) => setDeleteState({ kind: "file", nameOrPath: item.label })}
          />
        </div>
      </SettingsRow>

      {materialization?.lastError || error ? (
        <SettingsRow label="Status">
          <div className="max-w-xl text-sm text-destructive">
            {error ?? materialization?.lastError}
          </div>
        </SettingsRow>
      ) : null}

      <SecretEditorDialog
        open={Boolean(editorState)}
        state={editorState}
        filePathMode={filePathMode}
        scopeDescription={description}
        existingEnvKeys={existingEnvKeys}
        existingFileKeys={existingFileKeys}
        saving={saving}
        error={error}
        onClose={() => setEditorState(null)}
        onSave={handleEditorSave}
      />
      <SecretDeleteDialog
        open={Boolean(deleteState)}
        state={deleteState}
        loading={saving}
        onClose={() => setDeleteState(null)}
        onConfirm={handleDeleteConfirm}
      />
    </SettingsSection>
  );
}

function secretMetadataToListItem(item: SecretMetadata, label: string): SecretListItem {
  return {
    id: item.id,
    label,
    detail: `${item.byteSize} bytes · ${formatDate(item.updatedAt)}`,
  };
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function statusLabel(status: SecretMaterializationView["status"], loading: boolean): string {
  if (loading) {
    return "Loading";
  }
  switch (status) {
    case "ready":
      return "Materialized";
    case "running":
      return "Syncing";
    case "error":
      return "Error";
    case "pending":
      return "Pending";
  }
}
