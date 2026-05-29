import "@tanstack/react-query";

export interface AppQueryMeta {
  telemetryHandled?: true;
}

declare module "@tanstack/react-query" {
  interface Register {
    queryMeta: AppQueryMeta;
    mutationMeta: AppQueryMeta;
  }
}
