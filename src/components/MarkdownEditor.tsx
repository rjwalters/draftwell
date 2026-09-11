import { lazy, Suspense } from "react";
import { useTheme } from "@/hooks/use-theme";

const Editor = lazy(() => import("@monaco-editor/react").then((mod) => ({ default: mod.default })));

interface MarkdownEditorProps {
  value: string;
  readOnly?: boolean;
  onChange: (value: string) => void;
}

export function MarkdownEditor({ value, onChange, readOnly = false }: MarkdownEditorProps) {
  const { resolvedTheme } = useTheme();

  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center bg-background">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      }
    >
      <Editor
        language="markdown"
        theme={resolvedTheme === "dark" ? "vs-dark" : "vs"}
        value={value}
        onChange={(v) => onChange(v ?? "")}
        options={{
          readOnly,
          wordWrap: "on",
          minimap: { enabled: false },
          fontSize: 14,
          lineNumbers: "on",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          padding: { top: 12 },
        }}
        loading={
          <div className="flex h-full items-center justify-center bg-background">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        }
      />
    </Suspense>
  );
}
