import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * Drop-in variant of useUrlState that decouples the input's local state
 * from the URL. Typing stays responsive; the URL catches up after a
 * short debounce. Prevents the "can't type" glitch where back-to-back
 * setSearchParams calls (e.g. setSearch + setPage) during rapid typing
 * caused React Router to drop keystrokes when deployed behind a slow
 * CDN or service worker.
 *
 * Usage is identical to useUrlState:
 *   const [search, setSearch] = useDebouncedUrlState("q", "");
 *
 * The returned `search` value reflects the user's current typed input
 * immediately. The URL updates ~300ms after they stop typing. Query
 * hooks that depend on this value will see the local state on each
 * render, so filtering feels instantaneous — but the back button still
 * restores state because we sync to the URL.
 */
export function useDebouncedUrlState(
  key: string,
  defaultValue: string,
  delayMs = 300
): [string, (value: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialFromUrl = searchParams.get(key) ?? defaultValue;
  const [local, setLocal] = useState(initialFromUrl);

  // Debounced URL sync
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setValue = useCallback(
    (next: string) => {
      setLocal(next);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        setSearchParams(
          (prev) => {
            const np = new URLSearchParams(prev);
            if (next === defaultValue || next === "") np.delete(key);
            else np.set(key, next);
            return np;
          },
          { replace: true }
        );
      }, delayMs);
    },
    [key, defaultValue, delayMs, setSearchParams]
  );

  // If the URL changes externally (e.g. back button, deep link),
  // pull the new value into local state.
  const urlValue = searchParams.get(key) ?? defaultValue;
  useEffect(() => {
    setLocal(urlValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlValue]);

  // Flush the pending URL update on unmount so navigating away still
  // saves the typed value.
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return [local, setValue];
}
