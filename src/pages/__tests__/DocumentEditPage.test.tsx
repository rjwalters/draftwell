import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DocumentEditPage } from "../DocumentEditPage";

vi.mock("@/components/MarkdownEditor", () => ({
  MarkdownEditor: ({
    value,
    onChange,
    readOnly,
  }: {
    value: string;
    onChange: (value: string) => void;
    readOnly: boolean;
  }) => (
    <textarea
      aria-label="Markdown"
      value={value}
      readOnly={readOnly}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));
let saved: string;
let revision: number;
let failSave: boolean;
let delayedProposal: ((response: Response) => void) | null;
let delayProposal: boolean;
let putCount: number;
let acceptCount: number;
let status: string;
const response = (body: unknown, code = 200) =>
  new Response(JSON.stringify(body), { status: code });
const review = {
  id: "r",
  document_id: "d",
  revision_number: 0,
  summary: "Persisted review",
  created_at: "2026-09-11T00:00:00Z",
};
const candidate = () => ({
  candidateId: "c",
  baseRevision: revision,
  previousContent: saved,
  revisedContent: "Improved draft",
  summary: "Made it clear",
});

beforeEach(() => {
  saved = "Original draft";
  revision = 0;
  failSave = false;
  delayedProposal = null;
  delayProposal = false;
  putCount = 0;
  acceptCount = 0;
  status = "open";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/voice/profiles") return response({ profiles: [] });
      if (url.endsWith("/documents/d") && init?.method === "PUT") {
        putCount += 1;
        if (failSave) return response({ error: "Offline. Please retry." }, 503);
        const body = JSON.parse(init.body as string);
        if (body.baseRevision !== revision) return response({ error: "Conflict" }, 409);
        saved = body.content;
        revision += 1;
        return response({ document: { current_revision: revision } });
      }
      if (url.endsWith("/documents/d"))
        return response({
          content: saved,
          document: { title: "Draft", current_revision: revision },
        });
      if (url.endsWith("/reviews")) return response({ reviews: [review] });
      if (url.endsWith("/reviews/r"))
        return response({
          review,
          items: [
            {
              id: "i",
              category: "clarity",
              description: "Clarify this",
              severity: "warning",
              suggestion: "Add an example",
              source: "persona",
              status,
            },
          ],
        });
      if (url.endsWith("/ai/review")) {
        expect(JSON.parse(init?.body as string).baseRevision).toBe(revision);
        return response({ review, items: [] }, 201);
      }
      if (url.endsWith("/ai/revise")) {
        if (delayProposal)
          return new Promise<Response>((resolve) => {
            delayedProposal = resolve;
          });
        return response(candidate(), 201);
      }
      if (url.endsWith("/candidates/c/accept")) {
        acceptCount += 1;
        revision += 1;
        saved = "Improved draft";
        status = "addressed";
        return response({ content: saved, revision });
      }
      throw new Error(`Unexpected request: ${url}`);
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function load() {
  render(
    <MemoryRouter initialEntries={["/projects/p/documents/d/edit"]}>
      <Routes>
        <Route
          path="/projects/:projectId/documents/:documentId/edit"
          element={<DocumentEditPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
  return screen.findByRole("textbox", { name: "Markdown" });
}
async function openReview() {
  fireEvent.click(screen.getByRole("button", { name: "Review" }));
  await screen.findByText("Add an example");
  await waitFor(() => expect(screen.getByRole("button", { name: "Revise" })).toBeEnabled());
}

it("opens a document without saving and restores reviews after closing the panel", async () => {
  await load();
  await openReview();
  fireEvent.click(screen.getByRole("button", { name: "Review" }));
  expect(screen.queryByText("Persisted review")).not.toBeInTheDocument();
  await openReview();
  expect(screen.getByText("Persisted review")).toBeInTheDocument();
  expect(putCount).toBe(0);
});

it("flushes current edits before starting a review", async () => {
  const editor = await load();
  await openReview();
  fireEvent.change(editor, { target: { value: "Latest draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Re-Review" }));
  await waitFor(() => expect(putCount).toBe(1));
  await waitFor(() =>
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith("/ai/review"))).toBe(
      true,
    ),
  );
  expect(saved).toBe("Latest draft");
});

it("does not run review after a failed save and allows retry", async () => {
  const editor = await load();
  await openReview();
  failSave = true;
  fireEvent.change(editor, { target: { value: "Unsent draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Re-Review" }));
  await screen.findByRole("button", { name: "Retry save" });
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith("/ai/review"))).toBe(
    false,
  );
  expect(localStorage.getItem("draftwell:unsaved:p:d")).toBe("Unsent draft");
  failSave = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
  await waitFor(() => expect(saved).toBe("Unsent draft"));
});

it("previews before acceptance, then updates text without an extra autosave", async () => {
  const editor = await load();
  await openReview();
  fireEvent.click(screen.getByRole("button", { name: "Revise" }));
  await screen.findByRole("button", { name: "Accept revision" });
  expect(editor).toHaveValue("Original draft");
  expect(acceptCount).toBe(0);
  expect(
    screen.getByRole("region", { name: "Proposed changes" }).querySelector("ins"),
  ).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Accept revision" }));
  await waitFor(() => expect(editor).toHaveValue("Improved draft"));
  vi.useFakeTimers();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2500);
  });
  expect(putCount).toBe(0);
  expect(acceptCount).toBe(1);
});

it("preserves edits made while a proposal is generating", async () => {
  const editor = await load();
  await openReview();
  delayProposal = true;
  const generated = candidate();
  fireEvent.click(screen.getByRole("button", { name: "Revise" }));
  await waitFor(() => expect(delayedProposal).not.toBeNull());
  fireEvent.change(editor, { target: { value: "My newer words" } });
  await act(async () => {
    delayedProposal?.(response(generated, 201));
  });
  expect(editor).toHaveValue("My newer words");
  expect(screen.getByRole("button", { name: "Accept revision" })).toBeDisabled();
  expect(acceptCount).toBe(0);
});

it("offers local draft recovery without silently replacing the server version", async () => {
  localStorage.setItem("draftwell:unsaved:p:d", "Recovered words");
  const editor = await load();
  expect(editor).toHaveValue("Original draft");
  fireEvent.click(screen.getByRole("button", { name: "Restore draft" }));
  expect(editor).toHaveValue("Recovered words");
});
