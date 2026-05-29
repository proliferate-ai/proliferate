import {
  useEffect,
  useRef,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { Button } from "@proliferate/ui/primitives/Button";
import { Input } from "@proliferate/ui/primitives/Input";
import {
  ArrowUp,
  Search,
  X,
} from "@proliferate/ui/icons";
import {
  selectVisibleContentSearchMatchIds,
  type ContentSearchSurface,
  useContentSearchStore,
} from "@/stores/search/content-search-store";

interface SessionContentSearchOverlayProps {
  enabled: boolean;
  surface: ContentSearchSurface;
}

export function SessionContentSearchOverlay({
  enabled,
  surface,
}: SessionContentSearchOverlayProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const open = useContentSearchStore((state) => state.open);
  const activeSurface = useContentSearchStore((state) => state.surface);
  const query = useContentSearchStore((state) => state.query);
  const activeMatchIndex = useContentSearchStore((state) => state.activeMatchIndex);
  const activeMatchId = useContentSearchStore((state) => state.activeMatchId);
  const matchCount = useContentSearchStore((state) =>
    selectVisibleContentSearchMatchIds(state).length
  );
  const closeSearch = useContentSearchStore((state) => state.closeSearch);
  const setQuery = useContentSearchStore((state) => state.setQuery);
  const goToNextMatch = useContentSearchStore((state) => state.goToNextMatch);
  const goToPreviousMatch = useContentSearchStore((state) => state.goToPreviousMatch);
  const hasQuery = query.trim().length > 0;
  const hasMatches = matchCount > 0;
  const surfaceOpen = enabled && open && activeSurface === surface;

  useEffect(() => {
    if (surfaceOpen) {
      window.requestAnimationFrame(() => {
        inputRef.current?.select();
      });
    }
  }, [surfaceOpen]);

  useEffect(() => {
    if (!surfaceOpen || !activeMatchId) {
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
  }, [activeMatchId, surfaceOpen]);

  if (!surfaceOpen) {
    return null;
  }

  const placeholder = surface === "file"
    ? "Search file…"
    : "Search diff…";
  const inputLabel = surface === "file" ? "Find in file" : "Find in chat";
  const offsetClassName = surface === "file" ? "top-12" : "top-2";
  const resultRowColumnClass = "col-[1/3]";
  const resultLabel = hasMatches
    ? `${activeMatchIndex + 1} / ${matchCount} results`
    : "0 results";

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
      className={`pointer-events-none absolute ${offsetClassName} right-4 z-[55] flex justify-end`}
      data-content-search-overlay
      data-content-search-surface={surface}
    >
      <div className="pointer-events-auto grid w-[340px] max-w-[70vw] grid-cols-[minmax(0,1fr)_auto] overflow-hidden rounded-[20px] border-[0.5px] border-border bg-sidebar-background shadow-[0px_8px_16px_-4px_rgba(0,0,0,0.12)]">
        <div className="col-[1/2] row-[1] flex h-[44px] min-w-0 items-center gap-2 pl-4">
          <Search className="size-4 shrink-0 text-foreground" />
          <Input
            ref={inputRef}
            id="content-search-input"
            aria-label={inputLabel}
            placeholder={placeholder}
            className="h-6 min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 text-base leading-6 text-foreground outline-none placeholder:text-muted-foreground focus:ring-0"
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
            <div className={`${resultRowColumnClass} row-[2] flex min-w-0 items-center border-t border-border px-4 py-2 text-base leading-6 transition-[border-width,max-height,opacity,padding,translate] duration-200 ease-out max-h-9 translate-y-0 opacity-100`}>
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
            <span className={`pointer-events-none ${resultRowColumnClass} row-[2] min-w-0 px-4 py-2 text-right text-base leading-6 text-muted-foreground transition-[max-height,opacity,padding,translate] duration-200 ease-out max-h-9 translate-y-0 opacity-100`}>
              {resultLabel}
            </span>
          </>
        )}
        <div className="col-[2/3] row-[1] flex h-[44px] items-center pr-4">
          <div className="mr-2 ml-2 h-4 w-px bg-border" />
          <Button
            type="button"
            variant="unstyled"
            size="unstyled"
            aria-label="Close find"
            className="-m-0.5 flex size-6 items-center justify-center rounded-full text-foreground hover:bg-list-hover"
            onClick={closeSearch}
          >
            <X className="size-4" />
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
      className="flex size-4 items-center justify-center rounded-full p-0 text-muted-foreground hover:bg-list-hover hover:text-foreground disabled:opacity-40"
      onClick={onClick}
    >
      <ArrowUp className={`size-4 ${next ? "rotate-180" : ""}`} />
    </Button>
  );
}
