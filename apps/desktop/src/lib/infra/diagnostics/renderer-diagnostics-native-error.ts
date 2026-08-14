export function isRendererIngestProtocolError(error: unknown): boolean {
  if (error === "renderer_ingest_protocol_error") {
    return true;
  }
  if (typeof error !== "object" || error === null) {
    return false;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, "message");
    return descriptor !== undefined
      && "value" in descriptor
      && descriptor.value === "renderer_ingest_protocol_error";
  } catch {
    return false;
  }
}
