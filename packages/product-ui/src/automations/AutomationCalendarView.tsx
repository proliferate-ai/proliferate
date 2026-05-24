import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { twMerge } from "tailwind-merge";
import { Button } from "@proliferate/ui/primitives/Button";
import type {
  AutomationCalendarDayView,
  AutomationCalendarOccurrenceView,
} from "@proliferate/product-model/automations/inventory";
import { AutomationStatusGlyph } from "./AutomationStatusGlyph";

export interface AutomationCalendarViewProps {
  days: readonly AutomationCalendarDayView[];
  onAutomationSelect: (automationId: string) => void;
}

export function AutomationCalendarView({
  days,
  onAutomationSelect,
}: AutomationCalendarViewProps) {
  const defaultDayId = useMemo(() => days.find((day) => day.isToday)?.id ?? days[0]?.id ?? null, [days]);
  const [selectedDayId, setSelectedDayId] = useState<string | null>(defaultDayId);
  const sectionRefs = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    if (!selectedDayId || !days.some((day) => day.id === selectedDayId)) {
      setSelectedDayId(defaultDayId);
    }
  }, [days, defaultDayId, selectedDayId]);

  const setSectionRef = useCallback((dayId: string, element: HTMLElement | null) => {
    if (element) {
      sectionRefs.current.set(dayId, element);
    } else {
      sectionRefs.current.delete(dayId);
    }
  }, []);

  const selectDay = (dayId: string) => {
    setSelectedDayId(dayId);
    requestAnimationFrame(() => {
      sectionRefs.current.get(dayId)?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  };

  return (
    <div className="flex min-w-0 flex-col gap-6 pb-10">
      <div className="sticky top-10 z-10 -mx-1 bg-background/95 px-1 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="grid grid-cols-7 gap-1">
          {days.map((day) => {
            const active = selectedDayId === day.id;
            return (
              <Button
                key={day.id}
                variant="unstyled"
                size="unstyled"
                type="button"
                onClick={() => selectDay(day.id)}
                aria-pressed={active}
                aria-controls={`automation-calendar-${day.id}`}
                className={twMerge(
                  "flex min-h-16 flex-col items-center gap-0.5 rounded-lg px-2 py-2 text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.04] hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]",
                  active ? "bg-foreground/[0.075] text-foreground" : "",
                )}
              >
                <span className="text-[10px] font-medium uppercase leading-3 tracking-wide">
                  {day.weekdayLabel}
                </span>
                <span className="text-lg font-medium leading-6 tabular-nums">
                  {day.dayNumberLabel}
                </span>
                <span
                  className={twMerge(
                    "size-1 rounded-full",
                    day.hasOccurrences ? "bg-muted-foreground" : "bg-transparent",
                  )}
                  aria-hidden
                />
              </Button>
            );
          })}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-6">
        {days.map((day) => (
          <CalendarDaySection
            key={day.id}
            day={day}
            active={selectedDayId === day.id}
            setSectionRef={setSectionRef}
            onAutomationSelect={onAutomationSelect}
          />
        ))}
      </div>
    </div>
  );
}

function CalendarDaySection({
  day,
  active,
  setSectionRef,
  onAutomationSelect,
}: {
  day: AutomationCalendarDayView;
  active: boolean;
  setSectionRef: (dayId: string, element: HTMLElement | null) => void;
  onAutomationSelect: (automationId: string) => void;
}) {
  return (
    <section
      id={`automation-calendar-${day.id}`}
      ref={(element) => setSectionRef(day.id, element)}
      className={twMerge(
        "scroll-mt-24 rounded-[8px] px-4 py-3",
        active ? "bg-foreground/[0.035]" : "",
      )}
      aria-label={day.sectionLabel}
    >
      <h3
        className={twMerge(
          "mb-3 flex items-center gap-2 text-sm font-medium leading-5",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {active ? <span className="size-1.5 rounded-full bg-foreground" aria-hidden /> : null}
        {day.sectionLabel}
      </h3>
      {day.occurrences.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-1" role="list">
          {day.occurrences.map((occurrence) => (
            <OccurrenceRow
              key={occurrence.id}
              occurrence={occurrence}
              onAutomationSelect={onAutomationSelect}
            />
          ))}
        </div>
      ) : (
        <p className="text-xs leading-5 text-muted-foreground">No automations scheduled</p>
      )}
    </section>
  );
}

function OccurrenceRow({
  occurrence,
  onAutomationSelect,
}: {
  occurrence: AutomationCalendarOccurrenceView;
  onAutomationSelect: (automationId: string) => void;
}) {
  if (occurrence.overflowCount) {
    return (
      <div className="flex h-9 items-center gap-4 rounded-[5px] px-3 text-xs leading-4 text-muted-foreground" role="listitem">
        <span className="w-20 shrink-0 text-right tabular-nums" />
        <span>{occurrence.title}</span>
      </div>
    );
  }

  return (
    <div role="listitem">
      <Button
        variant="unstyled"
        size="unstyled"
        type="button"
        onClick={() => onAutomationSelect(occurrence.automationId)}
        className="group flex h-9 w-full items-center gap-4 rounded-[5px] px-3 text-left transition-colors hover:bg-foreground/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]"
        aria-label={`${occurrence.title}, ${occurrence.timeLabel}, ${occurrence.scopeLabel}, ${occurrence.targetLabel}, ${occurrence.statusLabel}`}
      >
        <span className="w-20 shrink-0 text-right text-sm leading-5 text-muted-foreground tabular-nums">
          {occurrence.timeLabel}
        </span>
        <span className="inline-flex shrink-0 items-center">
          <AutomationStatusGlyph status={occurrence.statusKind} size={12} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium leading-5 text-foreground">
            {occurrence.title}
          </span>
        </span>
        <span className="hidden min-w-0 max-w-[42%] truncate text-xs leading-4 text-muted-foreground md:block">
          {[occurrence.scopeLabel, occurrence.targetLabel, occurrence.scheduleLabel].filter(Boolean).join(" · ")}
        </span>
      </Button>
    </div>
  );
}
