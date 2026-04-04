export function setIndexedRef<T>(
  references: { current: (T | null)[] },
  index: number,
  element: T | null,
) {
  const next = [...references.current];
  next[index] = element;
  references.current = next;
}
