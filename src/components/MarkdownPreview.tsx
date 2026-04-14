import Markdown from "react-markdown";

interface MarkdownPreviewProps {
  content: string;
}

export function MarkdownPreview({ content }: MarkdownPreviewProps) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none overflow-auto p-4">
      <Markdown>{content}</Markdown>
    </div>
  );
}
