/** Prioritizes recent work while reserving one slot so historical backlog always advances. */
export function newestFirstWithOldestProgress<T>(oldestFirst: T[], limit: number): T[] {
  if (limit <= 0 || oldestFirst.length === 0) return [];
  if (oldestFirst.length <= limit) return [...oldestFirst].reverse();
  if (limit === 1) return [oldestFirst.at(-1)!];
  return [
    ...oldestFirst.slice(-(limit - 1)).reverse(),
    oldestFirst[0]!
  ];
}
