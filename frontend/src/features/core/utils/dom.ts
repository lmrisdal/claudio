export function setIndexedRef<T>(
  refs: { current: (T | null)[] },
  index: number,
  el: T | null,
) {
  const next = refs.current.slice();
  next[index] = el;
  refs.current = next;
}
