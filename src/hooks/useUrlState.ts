import { useSearchParams } from "react-router-dom";
import { useCallback } from "react";

/**
 * Like useState, but persists the value in URL search params.
 * When the user navigates back, the state is restored from the URL.
 *
 * IMPORTANT — react-router 7 quirk:
 *   setSearchParams((prev) => …) passes a STALE prev when called twice
 *   in the same event handler before a re-render. Concretely, if you do:
 *     setStatusFilter("mql");  // expects ?qual=mql
 *     setPage(0);              // expects ?qual=mql&page=0
 *   the second call's `prev` is still the empty URL because the
 *   component hasn't re-rendered yet, and `?page=0` clobbers `?qual=mql`.
 *
 * Workaround: read the LIVE URL via window.location.search inside the
 * setter so each update composes onto the latest browser state. This
 * keeps multi-filter changes (filter + page reset) intact.
 */
export function useUrlState(key: string, defaultValue: string): [string, (value: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const value = searchParams.get(key) ?? defaultValue;

  const setValue = useCallback(
    (newValue: string) => {
      const live = new URLSearchParams(window.location.search);
      if (newValue === defaultValue) {
        live.delete(key);
      } else {
        live.set(key, newValue);
      }
      setSearchParams(live, { replace: true });
    },
    [key, defaultValue, setSearchParams]
  );

  return [value, setValue];
}

/**
 * Like useUrlState but for an array of strings, encoded as a single
 * comma-separated value (e.g. ?status=active,pending). Empty array =
 * key removed from URL. Used by multi-select filters.
 */
export function useUrlArrayState(
  key: string
): [string[], (value: string[]) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get(key);
  const value = raw ? raw.split(",").filter(Boolean) : [];

  const setValue = useCallback(
    (newValue: string[]) => {
      const live = new URLSearchParams(window.location.search);
      if (!newValue.length) {
        live.delete(key);
      } else {
        live.set(key, newValue.join(","));
      }
      setSearchParams(live, { replace: true });
    },
    [key, setSearchParams]
  );

  return [value, setValue];
}

/**
 * Like useState for a number, but persists in URL search params.
 */
export function useUrlNumberState(key: string, defaultValue: number): [number, (value: number) => void] {
  const [raw, setRaw] = useUrlState(key, String(defaultValue));
  const value = parseInt(raw, 10);
  const numValue = isNaN(value) ? defaultValue : value;

  const setValue = useCallback(
    (newValue: number) => {
      setRaw(String(newValue));
    },
    [setRaw]
  );

  return [numValue, setValue];
}
