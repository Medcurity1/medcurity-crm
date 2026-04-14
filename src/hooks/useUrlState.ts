import { useSearchParams } from "react-router-dom";
import { useCallback } from "react";

/**
 * Like useState, but persists the value in URL search params.
 * When the user navigates back, the state is restored from the URL.
 */
export function useUrlState(key: string, defaultValue: string): [string, (value: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const value = searchParams.get(key) ?? defaultValue;

  const setValue = useCallback(
    (newValue: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (newValue === defaultValue) {
            next.delete(key);
          } else {
            next.set(key, newValue);
          }
          return next;
        },
        { replace: true }
      );
    },
    [key, defaultValue, setSearchParams]
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
