import { useCallback, useEffect, useRef } from "react";

export function useAutoSave(
  content: string,
  onSave: (content: string) => Promise<void>,
  delayMs = 2000,
) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef(content);
  const isSavingRef = useRef(false);
  const contentRef = useRef(content);
  const saveRef = useRef(onSave);

  contentRef.current = content;
  saveRef.current = onSave;

  const save = useCallback(async (value: string) => {
    if (isSavingRef.current || value === lastSavedRef.current) return;
    isSavingRef.current = true;
    try {
      await saveRef.current(value);
      lastSavedRef.current = value;
    } finally {
      isSavingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (content === lastSavedRef.current) return;

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      save(content);
    }, delayMs);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [content, delayMs, save]);

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      const current = contentRef.current;
      if (lastSavedRef.current !== current) {
        save(current);
      }
    };
  }, [save]);
}
