import Markdown from "react-markdown";

interface MarkdownPreviewProps {
  content: string;
}

export function MarkdownPreview({ content }: MarkdownPreviewProps) {
  return (
    <div className="prose prose-stone dark:prose-invert max-w-none overflow-auto px-8 py-6 prose-headings:font-serif prose-headings:font-normal prose-p:leading-relaxed prose-p:text-[15px] prose-li:text-[15px]">
      <Markdown>{content}</Markdown>
    </div>
  );
}
