import type { SessionEventEnvelope } from "@anyharness/sdk";

export function mergeFetchedHistoryWithNewerEvents(
  fetchedEvents: SessionEventEnvelope[],
  currentEvents: SessionEventEnvelope[],
): SessionEventEnvelope[] {
  const fetchedLastSeq = fetchedEvents.length > 0
    ? fetchedEvents[fetchedEvents.length - 1]?.seq ?? 0
    : 0;
  if (fetchedLastSeq <= 0) {
    return fetchedEvents;
  }

  const newerEvents = currentEvents.filter((event) => event.seq > fetchedLastSeq);
  if (newerEvents.length === 0) {
    return fetchedEvents;
  }

  return [...fetchedEvents, ...newerEvents].sort((a, b) => a.seq - b.seq);
}

export function mergeFetchedHistoryWithExistingEvents(
  fetchedEvents: SessionEventEnvelope[],
  currentEvents: SessionEventEnvelope[],
): SessionEventEnvelope[] {
  if (fetchedEvents.length === 0) {
    return currentEvents;
  }

  const eventsBySeq = new Map<number, SessionEventEnvelope>();
  for (const event of currentEvents) {
    eventsBySeq.set(event.seq, event);
  }
  for (const event of fetchedEvents) {
    eventsBySeq.set(event.seq, event);
  }

  return Array.from(eventsBySeq.values()).sort((a, b) => a.seq - b.seq);
}
