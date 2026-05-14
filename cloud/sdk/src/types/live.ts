export type CloudLivePatchKind =
  | "workspace"
  | "session"
  | "transcript"
  | "command"
  | "target";

export interface CloudLivePatch<TPayload = unknown> {
  id: string;
  kind: CloudLivePatchKind;
  sequence: number;
  payload: TPayload;
  createdAt?: string | null;
}

export interface CloudLiveSubscriptionOptions {
  afterSeq?: number | null;
  signal?: AbortSignal;
}

