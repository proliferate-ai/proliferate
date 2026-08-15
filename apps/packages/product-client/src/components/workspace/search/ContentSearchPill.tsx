import {
  useEffect,
  useRef,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { Button } from "#product/primitives/Button";
import { Input } from "#product/primitives/Input";
import { SegmentedControl, type SegmentedControlItem } from "#product/primitives/SegmentedControl";
import {
  ArrowUp,
  Search,
  X,
} from "#product/primitives/icons/core";
import {
  selectVisibleContentSearchMatchIds,
  type ContentSearchSurface,
  useContentSearchStore,
} from "#product/stores/search/content-search-store";

const SURFACE_COPY: Record<ContentSearchSurface, { placeholder: string; inputLabel: string }> = {
  chat: { placeholder: "Search chat…", inputLabel: "Find in chat" },
  file: { placeholder: "Search file…", inputLabel: "Find in file" },
  review: { placeholder: "Search changes…", inputLabel: "Find in changes" },
};

const SEARCH_SCOPE_ITEMS: readonly SegmentedControlItem<"chat" | "review">[] = [
  { id: "chat", label: "Chat" },
  { id: "review", label: "Diff" },
];

export function ContentSearchPill() {
  const inputRef = useRef<HTMLInputElement>(null);
  const open = useContentSearchStore((state) => state.open);
  const surface = useContentSearchStore((state) => state.surface);
  const query = useContentSearchStore((state) => state.query);
  const activeMatchIndex = useContentSearchStore((state) => state.activeMatchIndex);
  const activeMatchId = useContentSearchStore((state) => state.activeMatchId);
  const reviewAvailable = useContentSearchStore((state) => state.surfaceAvailability.review);
  const matchCount = useContentSearchStore((state) =>
    selectVisibleContentSearchMatchIds(state).length
  );
  const closeSearch = useContentSearchStore((state) => state.closeSearch);
  const setQuery = useContentSearchStore((state) => state.setQuery);
  const goToNextMatch = useContentSearchStore((state) => state.goToNextMatch);
  const goToPreviousMatch = useContentSearchStore((state) => state.goToPreviousMatch);
  const openSearch = useContentSearchStore((state) => state.openSearch);
  const hasQuery = query.trim().length > 0;
  const hasMatches = matchCount > 0;

  useEffect(() => {
    if (open) {
      window.requestAnimationFrame(() => {
        inputRef.current?.select();
      });
    }
  }, [open]);

  useEffect(() => {
    if (!open || !activeMatchId) {
      return;
    }

    const scrollActiveMatchIntoView = () => {
      const matches = document.querySelectorAll("[data-content-search-match-id]");
      for (const match of matches) {
        if (match.getAttribute("data-content-search-match-id") === activeMatchId) {
          match.scrollIntoView({ block: "center", inline: "nearest" });
          return true;
        }
      }

      return false;
    };

    window.requestAnimationFrame(() => {
      if (scrollActiveMatchIntoView()) {
        return;
      }

      window.requestAnimationFrame(scrollActiveMatchIntoView);
    });
  }, [activeMatchId, open]);

  if (!open) {
    return null;
  }

  const { placeholder, inputLabel } = SURFACE_COPY[surface];
  const resultRowColumnClass = "col-[1/3]";
  const resultLabel = hasMatches
    ? `${activeMatchIndex + 1} of ${matchCount}`
    : "No results";

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSearch();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) {
        goToPreviousMatch();
      } else {
        goToNextMatch();
      }
    }
  };

  return (
    <div
      // Pinned to the window's top-right corner, deliberately overlaying the
      // header/tab chrome band while search is open.
      className="pointer-events-none absolute top-2 right-4 z-popover flex justify-end"
      data-content-search-overlay
      data-content-search-surface={surface}
    >
      <div className="app-region-no-drag pointer-events-auto grid max-w-[70vw] w-[340px] grid-cols-[minmax(0,1fr)_auto] overflow-hidden rounded-xl border-[0.5px] border-border bg-sidebar-background shadow-popover">
        <div className="col-[1/2] row-[1] flex h-[44px] min-w-0 items-center gap-2 pl-4">
          <Search className="icon-paired shrink-0 text-foreground" />
          <Input
            ref={inputRef}
            id="content-search-input"
            aria-label={inputLabel}
            placeholder={placeholder}
            className="h-6 min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 text-ui leading-6 text-foreground outline-none placeholder:text-muted-foreground focus:ring-0"
            type="text"
            value={query}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              setQuery(event.target.value)
            }
            onKeyDown={handleKeyDown}
          />
        </div>
        {hasQuery && (
          <>
            <div className={`${resultRowColumnClass} row-[2] flex min-w-0 items-center border-t border-border px-4 py-2 text-ui leading-6 transition-[border-width,max-height,opacity,padding,translate] duration-disclosure ease-out max-h-9 translate-y-0 opacity-100`}>
              <div className="flex items-center gap-3">
                <SearchNavigationButton
                  label="Previous result"
                  disabled={!hasMatches}
                  onClick={goToPreviousMatch}
                />
                <SearchNavigationButton
                  label="Next result"
                  disabled={!hasMatches}
                  onClick={goToNextMatch}
                  next
                />
              </div>
            </div>
            <span className={`pointer-events-none ${resultRowColumnClass} row-[2] min-w-0 px-4 py-2 text-right text-ui-sm leading-6 text-muted-foreground transition-[max-height,opacity,padding,translate] duration-disclosure ease-out max-h-9 translate-y-0 opacity-100`}>
              {resultLabel}
            </span>
          </>
        )}
        <div className="col-[2/3] row-[1] flex h-[44px] items-center pr-4">
          {reviewAvailable && (
            <>
              <SegmentedControl
                variant="plain"
                ariaLabel="Search scope"
                value={surface === "review" ? "review" : "chat"}
                items={SEARCH_SCOPE_ITEMS}
                onChange={(id) => openSearch(id)}
              />
              <div className="mr-2 ml-2 h-4 w-px bg-border" />
            </>
          )}
          <Button
            type="button"
            variant="unstyled"
            size="unstyled"
            aria-label="Close find"
            className="-m-0.5 flex size-6 items-center justify-center rounded-full text-foreground hover:bg-hover"
            onClick={closeSearch}
          >
            <X className="icon-paired" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function SearchNavigationButton({
  label,
  disabled,
  next = false,
  onClick,
}: {
  label: string;
  disabled: boolean;
  next?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="unstyled"
      size="unstyled"
      aria-label={label}
      disabled={disabled}
      className="flex size-4 items-center justify-center rounded-full p-0 text-muted-foreground hover:bg-hover hover:text-foreground disabled:opacity-40"
      onClick={onClick}
    >
      <ArrowUp className={`icon-paired ${next ? "rotate-180" : ""}`} />
    </Button>
  );
}
