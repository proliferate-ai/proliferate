// The secret editor's vocabulary: the kinds a secret can be, the ways file
// content can arrive, and the human labels for each. Split out of
// SecretEditorDialog.tsx so the component file holds the form and its
// behavior while the closed sets that both the dialog and its callers switch
// on live in one dependency-free leaf.

/** Whether the secret is an environment variable or a file on disk. */
export type SecretEditorKind = "env" | "file";
/** How a file secret's contents arrive: typed into the form, or uploaded. */
export type SecretFileContentSource = "text" | "upload";
/** Whether a file secret's path is absolute or repo-relative. */
export type SecretFilePathMode = "absolute" | "relative";

export const SECRET_KIND_LABELS: Record<SecretEditorKind, string> = {
  env: "Environment variable",
  file: "File",
};

export const SECRET_KIND_OPTIONS: readonly SecretEditorKind[] = ["env", "file"];

export const FILE_CONTENT_SOURCE_LABELS: Record<SecretFileContentSource, string> = {
  text: "Paste text",
  upload: "Upload file",
};

export const FILE_CONTENT_SOURCE_OPTIONS: readonly SecretFileContentSource[] = [
  "text",
  "upload",
];
