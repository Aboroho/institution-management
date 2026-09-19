"use client";
import { useEffect, useState } from "react";

/**
 * Debounced mirror of a rapidly changing value (typically a search box).
 *
 * The input stays fully controlled and responsive; only the value that triggers
 * a request lags behind, so typing "abdul" issues one query instead of five.
 * The delay is skipped when the value is cleared, because clearing a filter
 * should feel immediate.
 */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    if (value === "" || value === null || value === undefined) {
      setDebounced(value);
      return;
    }
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
