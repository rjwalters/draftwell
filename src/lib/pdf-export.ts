import { jsPDF } from "jspdf";
import { Lexer, type Token, type Tokens } from "marked";

interface PdfState {
  doc: jsPDF;
  y: number;
  pageWidth: number;
  pageHeight: number;
  margin: number;
  contentWidth: number;
  lineHeight: number;
  fontSize: number;
  pageNumber: number;
}

const FONT_SIZES = {
  h1: 22,
  h2: 18,
  h3: 15,
  h4: 13,
  body: 11,
  small: 9,
} as const;

const LINE_HEIGHTS = {
  h1: 10,
  h2: 8,
  h3: 7,
  h4: 6,
  body: 5.5,
} as const;

const MARGIN = 25;
const HEADER_SPACE = 12;
const PARAGRAPH_SPACE = 6;

function ensureSpace(state: PdfState, needed: number): void {
  if (state.y + needed > state.pageHeight - MARGIN - 15) {
    addPageNumber(state);
    state.doc.addPage();
    state.pageNumber++;
    state.y = MARGIN;
  }
}

function addPageNumber(state: PdfState): void {
  state.doc.setFontSize(FONT_SIZES.small);
  state.doc.setFont("helvetica", "normal");
  state.doc.setTextColor(150, 150, 150);
  state.doc.text(
    `${state.pageNumber}`,
    state.pageWidth / 2,
    state.pageHeight - 10,
    { align: "center" },
  );
  state.doc.setTextColor(0, 0, 0);
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

function renderWrappedText(
  state: PdfState,
  text: string,
  fontSize: number,
  lineHeight: number,
  fontStyle: "normal" | "bold" | "italic" = "normal",
  indent = 0,
): void {
  state.doc.setFontSize(fontSize);
  state.doc.setFont("helvetica", fontStyle);
  const effectiveWidth = state.contentWidth - indent;
  const lines = state.doc.splitTextToSize(text, effectiveWidth);
  for (const line of lines) {
    ensureSpace(state, lineHeight);
    state.doc.text(line, state.margin + indent, state.y);
    state.y += lineHeight;
  }
}

function renderHeading(state: PdfState, token: Tokens.Heading): void {
  const depth = token.depth as 1 | 2 | 3 | 4;
  const sizeKey = depth <= 4 ? (`h${depth}` as keyof typeof FONT_SIZES) : "h4";
  const fontSize = FONT_SIZES[sizeKey];
  const lineHeight =
    LINE_HEIGHTS[sizeKey as keyof typeof LINE_HEIGHTS] ?? LINE_HEIGHTS.body;

  state.y += HEADER_SPACE;
  ensureSpace(state, lineHeight + 4);

  const text = stripInlineMarkdown(token.text);
  renderWrappedText(state, text, fontSize, lineHeight, "bold");

  // Underline for h1/h2
  if (depth <= 2) {
    state.doc.setDrawColor(200, 200, 200);
    state.doc.setLineWidth(depth === 1 ? 0.5 : 0.3);
    state.doc.line(
      state.margin,
      state.y - 1,
      state.margin + state.contentWidth,
      state.y - 1,
    );
    state.y += 3;
  }

  state.y += 2;
}

function renderParagraph(state: PdfState, token: Tokens.Paragraph): void {
  const text = stripInlineMarkdown(token.text);
  renderWrappedText(state, text, FONT_SIZES.body, LINE_HEIGHTS.body);
  state.y += PARAGRAPH_SPACE;
}

function renderList(state: PdfState, token: Tokens.List): void {
  for (let i = 0; i < token.items.length; i++) {
    const item = token.items[i];
    const bullet = token.ordered ? `${i + 1}.` : "\u2022";
    const text = stripInlineMarkdown(item.text);

    ensureSpace(state, LINE_HEIGHTS.body);
    state.doc.setFontSize(FONT_SIZES.body);
    state.doc.setFont("helvetica", "normal");
    state.doc.text(bullet, state.margin + 4, state.y);

    renderWrappedText(
      state,
      text,
      FONT_SIZES.body,
      LINE_HEIGHTS.body,
      "normal",
      12,
    );
    state.y += 1;
  }
  state.y += PARAGRAPH_SPACE;
}

function renderCode(state: PdfState, token: Tokens.Code): void {
  state.y += 2;

  // Light gray background
  const lines = token.text.split("\n");
  const codeLineHeight = 4.5;
  const blockHeight = lines.length * codeLineHeight + 6;

  ensureSpace(state, Math.min(blockHeight, 60));

  state.doc.setFillColor(245, 245, 245);
  const remainingHeight = state.pageHeight - MARGIN - 15 - state.y;
  const bgHeight = Math.min(blockHeight, remainingHeight);
  state.doc.rect(
    state.margin,
    state.y - 2,
    state.contentWidth,
    bgHeight,
    "F",
  );

  state.doc.setFontSize(9);
  state.doc.setFont("courier", "normal");
  state.y += 2;

  for (const line of lines) {
    ensureSpace(state, codeLineHeight);
    const truncated = line.length > 90 ? `${line.substring(0, 87)}...` : line;
    state.doc.text(truncated, state.margin + 4, state.y);
    state.y += codeLineHeight;
  }

  state.y += PARAGRAPH_SPACE;
}

function renderBlockquote(state: PdfState, token: Tokens.Blockquote): void {
  state.y += 2;

  // Draw left border
  const startY = state.y;
  state.doc.setDrawColor(180, 180, 180);
  state.doc.setLineWidth(1.5);

  const text = token.tokens
    .filter((t): t is Tokens.Paragraph => t.type === "paragraph")
    .map((t) => stripInlineMarkdown(t.text))
    .join("\n");

  state.doc.setTextColor(100, 100, 100);
  renderWrappedText(
    state,
    text,
    FONT_SIZES.body,
    LINE_HEIGHTS.body,
    "italic",
    10,
  );
  state.doc.setTextColor(0, 0, 0);

  state.doc.line(state.margin + 3, startY - 2, state.margin + 3, state.y);
  state.y += PARAGRAPH_SPACE;
}

function renderHr(state: PdfState): void {
  state.y += 4;
  ensureSpace(state, 8);
  state.doc.setDrawColor(200, 200, 200);
  state.doc.setLineWidth(0.3);
  state.doc.line(
    state.margin,
    state.y,
    state.margin + state.contentWidth,
    state.y,
  );
  state.y += 8;
}

function renderToken(state: PdfState, token: Token): void {
  switch (token.type) {
    case "heading":
      renderHeading(state, token as Tokens.Heading);
      break;
    case "paragraph":
      renderParagraph(state, token as Tokens.Paragraph);
      break;
    case "list":
      renderList(state, token as Tokens.List);
      break;
    case "code":
      renderCode(state, token as Tokens.Code);
      break;
    case "blockquote":
      renderBlockquote(state, token as Tokens.Blockquote);
      break;
    case "hr":
      renderHr(state);
      break;
    case "html":
      // Skip raw HTML blocks
      break;
    case "space":
      state.y += 2;
      break;
    case "table": {
      const table = token as Tokens.Table;
      renderParagraph(state, {
        type: "paragraph",
        raw: "",
        text: table.header.map((h) => stripInlineMarkdown(h.text)).join(" | "),
        tokens: [],
      });
      for (const row of table.rows) {
        renderParagraph(state, {
          type: "paragraph",
          raw: "",
          text: row.map((c) => stripInlineMarkdown(c.text)).join(" | "),
          tokens: [],
        });
      }
      state.y += PARAGRAPH_SPACE;
      break;
    }
    default:
      // For unknown token types with text, render as paragraph
      if ("text" in token && typeof token.text === "string") {
        renderWrappedText(
          state,
          stripInlineMarkdown(token.text),
          FONT_SIZES.body,
          LINE_HEIGHTS.body,
        );
        state.y += PARAGRAPH_SPACE;
      }
  }
}

function renderImage(state: PdfState, text: string): void {
  state.y += 2;
  ensureSpace(state, 20);

  state.doc.setFillColor(240, 240, 240);
  state.doc.rect(state.margin, state.y - 2, state.contentWidth, 16, "F");

  state.doc.setFontSize(FONT_SIZES.small);
  state.doc.setFont("helvetica", "italic");
  state.doc.setTextColor(120, 120, 120);
  state.doc.text(`[Image: ${text}]`, state.margin + 4, state.y + 8);
  state.doc.setTextColor(0, 0, 0);

  state.y += 20;
}

export function exportToPdf(markdown: string, title: string): void {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const state: PdfState = {
    doc,
    y: MARGIN,
    pageWidth,
    pageHeight,
    margin: MARGIN,
    contentWidth: pageWidth - 2 * MARGIN,
    lineHeight: LINE_HEIGHTS.body,
    fontSize: FONT_SIZES.body,
    pageNumber: 1,
  };

  // Title page header
  doc.setFontSize(FONT_SIZES.h1);
  doc.setFont("helvetica", "bold");
  const titleLines = doc.splitTextToSize(title, state.contentWidth);
  for (const line of titleLines) {
    doc.text(line, MARGIN, state.y);
    state.y += 10;
  }

  doc.setDrawColor(100, 100, 100);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, state.y, MARGIN + state.contentWidth, state.y);
  state.y += 12;

  // Handle image placeholders by pre-processing
  const processedMarkdown = markdown.replace(
    /!\[([^\]]*)\]\([^)]+\)/g,
    (_match, alt) => {
      return `<!--img:${alt}-->`;
    },
  );

  // Tokenize markdown
  const lexer = new Lexer();
  const tokens = lexer.lex(processedMarkdown);

  for (const token of tokens) {
    // Check for image placeholder comments
    if (token.type === "html" && token.text.startsWith("<!--img:")) {
      const alt = token.text.replace("<!--img:", "").replace("-->", "");
      renderImage(state, alt || "No description");
      continue;
    }
    renderToken(state, token);
  }

  // Add page number to last page
  addPageNumber(state);

  // Download
  const safeTitle = title
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase();
  doc.save(`${safeTitle || "document"}.pdf`);
}
