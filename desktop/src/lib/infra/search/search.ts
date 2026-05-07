export function matchesPickerSearch(values: string[], search: string): boolean {
  const normalizedSearch = search.trim().toLowerCase();
  if (!normalizedSearch) {
    return true;
  }

  return values.some((value) => value.toLowerCase().includes(normalizedSearch));
}
