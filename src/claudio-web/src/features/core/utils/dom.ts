export function setIndexedRef<T>(
  references: { current: (T | null)[] },
  index: number,
  element: T | null,
) {
  const next = [...references.current];
  next[index] = element;
  references.current = next;
}

export function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return (
    target.closest("input, textarea, select, [contenteditable='true'], [role='textbox']") !== null
  );
}
