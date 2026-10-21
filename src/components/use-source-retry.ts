import { useCallback, useEffect, useRef } from "react";
import { router, useFocusEffect } from "expo-router";
import { useShelf } from "../lib/app-state";

// Keep the original operation on its screen. Retry once only after a successful
// verification and return; backing out or leaving the screen never replays it.
export function useSourceRetry(retry: () => void) {
  const { sourceSessionRevision } = useShelf();
  const operation = useRef(retry);
  const pending = useRef<number | null>(null);
  useEffect(() => { operation.current = retry; });
  useFocusEffect(useCallback(() => {
    const before = pending.current;
    pending.current = null;
    if (before !== null && sourceSessionRevision > before) operation.current();
  }, [sourceSessionRevision]));
  return () => {
    if (pending.current !== null) return;
    pending.current = sourceSessionRevision;
    router.push("/verify-source");
  };
}
