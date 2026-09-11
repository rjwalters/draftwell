import { useCallback, useEffect, useRef, useState } from "react";

/** Mount once per loaded document so initial content is the saved baseline. */
export function useAutoSave(
  content: string,
  onSave: (content: string) => Promise<void>,
  delayMs = 2000,
) {
  const contentRef = useRef(content);
  const savedRef = useRef(content);
  const saveRef = useRef(onSave);
  const inFlight = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, refresh] = useState(0);
  contentRef.current = content;
  saveRef.current = onSave;

  const flush = useCallback((): Promise<void> => {
    clearTimeout(timer.current);
    if (inFlight.current) return inFlight.current;
    if (contentRef.current === savedRef.current) return Promise.resolve();
    setSaving(true);
    setError(null);
    const pending = (async () => {
      // Capture every new edit, including ones arriving during a slow request or
      // an unmount. A failed write never advances the saved baseline.
      while (contentRef.current !== savedRef.current) {
        const value = contentRef.current;
        await saveRef.current(value);
        savedRef.current = value;
      }
    })();
    inFlight.current = pending
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Could not save your changes.");
        throw err;
      })
      .finally(() => {
        inFlight.current = null;
        setSaving(false);
      });
    return inFlight.current;
  }, []);

  const markSaved = useCallback((value: string) => {
    savedRef.current = value;
    contentRef.current = value;
    setError(null);
    refresh((n) => n + 1);
  }, []);

  useEffect(() => {
    if (content !== savedRef.current) {
      timer.current = setTimeout(() => {
        void flush().catch(() => {});
      }, delayMs);
    }
    return () => clearTimeout(timer.current);
  }, [content, delayMs, flush]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (inFlight.current || contentRef.current !== savedRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      clearTimeout(timer.current);
      void flush().catch(() => {});
    };
  }, [flush]);

  return {
    flush,
    markSaved,
    error,
    isDirty: content !== savedRef.current || saving,
    status: saving ? "saving" : content !== savedRef.current ? "unsaved" : "saved",
  };
}
