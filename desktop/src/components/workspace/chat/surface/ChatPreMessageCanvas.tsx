import type { ReactNode } from "react";

interface ChatPreMessageCanvasProps {
  children: ReactNode;
}

/**
 * Shared parent for the loading and ready heroes. Owns the column geometry
 * (max-w-3xl, px-7) so the two children swap inside one stable layout — the
 * loading → ready transition becomes a content fade rather than a position
 * jump. Matches the transcript column shape (see MessageList.tsx) so when the
 * first turn finally lands, the content alignment doesn't shift either.
 */
export function ChatPreMessageCanvas({ children }: ChatPreMessageCanvasProps) {
  return (
    <div className="flex flex-1 min-h-0">
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center justify-center px-7 py-8">
        {children}
      </div>
    </div>
  );
}
