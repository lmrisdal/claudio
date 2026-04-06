import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type InputScopeKind = "page" | "menu" | "dialog" | "overlay" | "recording";
export type BlockedInputAction = "guide" | "page-nav" | "search";

interface InputScopeRegistration {
  id: string;
  kind: InputScopeKind;
  blocks?: readonly BlockedInputAction[];
}

interface RegisteredInputScope extends InputScopeRegistration {
  order: number;
}

interface InputScopeContextValue {
  topScope: RegisteredInputScope | null;
  isActionBlocked: (action: BlockedInputAction, requesterId?: string) => boolean;
  registerScope: (scope: InputScopeRegistration) => () => void;
}

const priorityByKind: Record<InputScopeKind, number> = {
  page: 1,
  menu: 2,
  dialog: 3,
  overlay: 4,
  recording: 5,
};

const InputScopeContext = createContext<InputScopeContextValue | null>(null);

export function InputScopeProvider({ children }: { children: ReactNode }) {
  const nextOrderReference = useRef(0);
  const [scopes, setScopes] = useState<RegisteredInputScope[]>([]);

  const registerScope = useCallback((scope: InputScopeRegistration) => {
    const nextScope: RegisteredInputScope = {
      ...scope,
      blocks: [...(scope.blocks ?? [])],
      order: nextOrderReference.current++,
    };

    setScopes((current) => [...current.filter((entry) => entry.id !== scope.id), nextScope]);

    return () => {
      setScopes((current) => current.filter((entry) => entry.id !== scope.id));
    };
  }, []);

  const topScope = useMemo(
    () =>
      scopes.reduce<RegisteredInputScope | null>((currentTop, scope) => {
        if (currentTop === null) {
          return scope;
        }

        const currentPriority = priorityByKind[currentTop.kind];
        const nextPriority = priorityByKind[scope.kind];
        if (nextPriority > currentPriority) {
          return scope;
        }

        if (nextPriority === currentPriority && scope.order > currentTop.order) {
          return scope;
        }

        return currentTop;
      }, null),
    [scopes],
  );

  const isActionBlocked = useCallback(
    (action: BlockedInputAction, requesterId?: string) =>
      topScope !== null &&
      topScope.id !== requesterId &&
      topScope.blocks?.includes(action) === true,
    [topScope],
  );

  const value = useMemo(
    () => ({ topScope, isActionBlocked, registerScope }),
    [topScope, isActionBlocked, registerScope],
  );

  return createElement(InputScopeContext.Provider, { value }, children);
}

export function useInputScopeState() {
  const context = useContext(InputScopeContext);
  if (!context) {
    throw new Error("useInputScopeState must be used within InputScopeProvider");
  }

  return context;
}

export function useInputScope({
  id,
  kind,
  blocks = [],
  enabled = true,
}: InputScopeRegistration & { enabled?: boolean }) {
  const { registerScope } = useInputScopeState();
  const blockKey = blocks.join(":");
  const stableBlocks = useMemo(
    () => (blockKey === "" ? [] : (blockKey.split(":") as BlockedInputAction[])),
    [blockKey],
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }

    return registerScope({ id, kind, blocks: stableBlocks });
  }, [enabled, id, kind, registerScope, stableBlocks]);
}
