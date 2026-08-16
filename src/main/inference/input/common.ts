export function modelInput(value: object, maximumCharacters?: number): string {
  if (!maximumCharacters) return JSON.stringify(value);
  for (const limits of [
    { array: 16, string: 500 },
    { array: 10, string: 320 },
    { array: 6, string: 200 }
  ]) {
    const candidate = JSON.stringify(compactValue(value, limits.array, limits.string));
    if (candidate.length <= maximumCharacters) return candidate;
  }
  const smallest = JSON.stringify(compactValue(value, 2, 80));
  if (smallest.length <= maximumCharacters) return smallest;
  return JSON.stringify({
    truncatedEvidence: smallest.slice(0, Math.max(0, maximumCharacters - 40))
  });
}

function compactValue(value: unknown, arrayLimit: number, stringLimit: number): unknown {
  if (typeof value === "string") return value.length <= stringLimit ? value : `${value.slice(0, stringLimit - 1)}…`;
  if (Array.isArray(value)) {
    const selected = value.length <= arrayLimit
      ? value
      : Array.from({ length: arrayLimit }, (_entry, index) =>
        value[Math.round((index * (value.length - 1)) / (arrayLimit - 1))]
      );
    return selected.map((entry) => compactValue(entry, arrayLimit, stringLimit));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      compactValue(entry, arrayLimit, stringLimit)
    ]));
  }
  return value;
}
