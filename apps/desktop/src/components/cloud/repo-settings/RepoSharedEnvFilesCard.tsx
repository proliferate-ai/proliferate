import type { ChangeEvent } from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import { Label } from "@proliferate/ui/primitives/Label";
import { Plus, Trash } from "@proliferate/ui/icons";
import {
  EnvironmentField,
  EnvironmentPanel,
  EnvironmentPanelRow,
} from "@proliferate/ui/layout/EnvironmentLayout";
import type {
  CloudRepoEnvVarRow,
  CloudRepoSharedEnvFile,
} from "@/lib/domain/settings/cloud-repo-config-draft";

interface RepoSharedEnvFilesCardProps {
  files: CloudRepoSharedEnvFile[];
  onAddFile: () => void;
  onUpdateFilePath: (fileId: string, relativePath: string) => void;
  onAddRow: (fileId: string) => void;
  onUpdateRow: (
    fileId: string,
    rowId: string,
    patch: Partial<Pick<CloudRepoEnvVarRow, "key" | "value">>,
  ) => void;
  onRemoveRow: (fileId: string, rowId: string) => void;
  onRemoveFile: (fileId: string) => void;
}

export function RepoSharedEnvFilesCard({
  files,
  onAddFile,
  onUpdateFilePath,
  onAddRow,
  onUpdateRow,
  onRemoveRow,
  onRemoveFile,
}: RepoSharedEnvFilesCardProps) {
  return (
    <EnvironmentField
      label="Shared env files"
      description="Admin-authored .env-style files written into new shared cloud workspaces."
    >
      <div className="space-y-3">
        {files.length === 0 ? (
          <EnvironmentPanel>
            <EnvironmentPanelRow>
              <p className="text-sm text-muted-foreground">
                No shared env files yet. Add one to write stable key/value files such as <code>.env.shared</code> into newly created shared workspaces.
              </p>
            </EnvironmentPanelRow>
          </EnvironmentPanel>
        ) : (
          <div className="space-y-3">
            {files.map((file) => (
              <EnvironmentPanel key={file.id}>
                <EnvironmentPanelRow>
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-2 md:flex-row md:items-end">
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <Label htmlFor={`shared-env-file-path-${file.id}`}>File path</Label>
                        <Input
                          id={`shared-env-file-path-${file.id}`}
                          value={file.relativePath}
                          placeholder=".env.shared"
                          onChange={(event: ChangeEvent<HTMLInputElement>) =>
                            onUpdateFilePath(file.id, event.target.value)}
                          className="h-8 px-2.5 py-1.5 font-mono text-sm leading-[var(--readable-code-line-height)]"
                        />
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => onRemoveFile(file.id)}
                      >
                        <Trash className="mr-2 size-4" />
                        Remove file
                      </Button>
                    </div>

                    <div className="space-y-2">
                      <div className="hidden grid-cols-[minmax(12rem,0.8fr)_minmax(16rem,1.2fr)_auto] gap-3 px-0.5 text-xs font-medium uppercase text-muted-foreground md:grid">
                        <span>Key</span>
                        <span>Value</span>
                        <span className="sr-only">Actions</span>
                      </div>

                      {file.rows.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          This file has no variables. Add a row to write values into it.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {file.rows.map((row) => (
                            <div
                              key={row.id}
                              className="grid gap-3 md:grid-cols-[minmax(12rem,0.8fr)_minmax(16rem,1.2fr)_auto]"
                            >
                              <div className="space-y-1.5">
                                <Label
                                  className="md:sr-only"
                                  htmlFor={`shared-env-file-key-${file.id}-${row.id}`}
                                >
                                  Key
                                </Label>
                                <Input
                                  id={`shared-env-file-key-${file.id}-${row.id}`}
                                  value={row.key}
                                  placeholder="API_BASE_URL"
                                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                                    onUpdateRow(file.id, row.id, { key: event.target.value })}
                                  className="h-8 px-2.5 py-1.5 font-mono text-sm leading-[var(--readable-code-line-height)]"
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label
                                  className="md:sr-only"
                                  htmlFor={`shared-env-file-value-${file.id}-${row.id}`}
                                >
                                  Value
                                </Label>
                                <Input
                                  id={`shared-env-file-value-${file.id}-${row.id}`}
                                  value={row.value}
                                  placeholder="https://example.internal"
                                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                                    onUpdateRow(file.id, row.id, { value: event.target.value })}
                                  className="h-8 px-2.5 py-1.5 font-mono text-sm leading-[var(--readable-code-line-height)]"
                                />
                              </div>
                              <div className="flex items-end">
                                <Button
                                  type="button"
                                  variant="outline"
                                  aria-label="Remove variable"
                                  onClick={() => onRemoveRow(file.id, row.id)}
                                >
                                  <Trash className="size-4" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => onAddRow(file.id)}
                      >
                        <Plus className="mr-2 size-4" />
                        Add variable
                      </Button>
                    </div>
                  </div>
                </EnvironmentPanelRow>
              </EnvironmentPanel>
            ))}
          </div>
        )}

        <Button type="button" variant="outline" onClick={onAddFile}>
          <Plus className="mr-2 size-4" />
          Add shared env file
        </Button>
      </div>
    </EnvironmentField>
  );
}
