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
