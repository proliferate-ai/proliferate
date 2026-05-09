let longTaskObserverSupported = false;

export function setLongTaskObserverSupportedForMeasurement(supported: boolean): void {
  longTaskObserverSupported = supported;
}

export function getLongTaskObserverSupportedForMeasurement(): boolean {
  return longTaskObserverSupported;
}

export function resetLongTaskObserverSupportForTest(): void {
  longTaskObserverSupported = false;
}
