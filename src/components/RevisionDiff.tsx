import { diffWordsWithSpace } from "diff";
import { useMemo } from "react";

export function RevisionDiff({ before, after }: { before: string; after: string }) {
  const parts = useMemo(() => {
    let offset = 0;
    return diffWordsWithSpace(before, after, { timeout: 1000 })?.map((part) => {
      const key = offset;
      offset += part.value.length;
      return { ...part, key };
    });
  }, [before, after]);
  if (!parts)
    return (
      <div className="grid grid-cols-2 gap-4">
        <pre className="whitespace-pre-wrap">{before}</pre>
        <pre className="whitespace-pre-wrap">{after}</pre>
      </div>
    );
  return (
    <section className="whitespace-pre-wrap text-sm leading-relaxed" aria-label="Proposed changes">
      {parts.map((part) =>
        part.added ? (
          <ins
            key={part.key}
            className="bg-green-100 text-green-950 dark:bg-green-950 dark:text-green-100"
          >
            {part.value}
          </ins>
        ) : part.removed ? (
          <del key={part.key} className="bg-red-100 text-red-950 dark:bg-red-950 dark:text-red-100">
            {part.value}
          </del>
        ) : (
          <span key={part.key}>{part.value}</span>
        ),
      )}
    </section>
  );
}
