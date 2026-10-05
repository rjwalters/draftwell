# Draftwell functionality audit

Date: 2026-09-11. Source: [Draftwell e1dff67](https://github.com/rjwalters/draftwell/tree/e1dff67814084e07a820371c96b0e480119f952f).

The standard checks are green, but confirmed autosave and authorization defects should precede feature expansion. The next architectural opportunity is sharing Anvil's writing machinery; see [the integration assessment](ANVIL_INTEGRATION.md).

## Validation

| Check | Result |
|---|---|
| Root `npm ci --no-audit --no-fund` | Passed |
| `npm run check:ci` | TypeScript, Biome, and 133 tests passed; React act warnings in some tests |
| `npm run build` | Passed; nine invalid CSS-property warnings from orchestration text scanned as Tailwind utilities |
| review-panel build and tests, after installing its own dev dependencies | 71 tests passed |
| Additional typecheck including `functions/**/*.ts`, excluding tests, with `@cloudflare/workers-types` | Failed: `functions/lib/voice.ts:150`, missing `BaseAiTextGenerationModels` |
| Two focused autosave regression cases | Both fail: only edit A is saved; later edit B is omitted |
| Two focused revise/refine authorization cases | Both fail: an unrelated review is accepted, returning 201 instead of 404 |

Tests ran against latest GitHub main in `/tmp/draftwell-audit-20260911`, preserving the primary checkout's divergent settings commit. Reproduction tests and logs remain in that temporary checkout and `/tmp/draftwell-audit-*.log`; they are intentionally failing probes, separate from the existing suite.

Scope: source review, production build, existing automated tests, and targeted mocked regression cases. Browser flows, live Google OAuth, live model responses, and deployment configuration were not exercised. No production data was changed.

## 1. Review ownership is missing in revise/refine — P1

Evidence: [ai.ts](https://github.com/rjwalters/draftwell/blob/e1dff67/functions/lib/ai.ts#L338), both `handleGenerateRevision` and `handleGenerateRefinement`.

The handlers verify the requested project and document, then load items using only the caller-supplied `reviewId`. They never verify that the review belongs to that document. The model receives those items and the handler updates their statuses by item ID.

A caller who knows an unrelated review ID can apply its findings to their own document. With another user's review ID, this crosses an authorization boundary and can modify the other user's finding statuses. This does not imply IDs are publicly discoverable.

Reproduction: use an owned project/document, supply a foreign review ID with open items, and mock the model response. Both handlers return 201; expected 404. These tests expose the missing lookup with mocked D1/R2/model calls, not live accounts.

Acceptance: join review → document → project before loading feedback or calling the model. Reject unknown, cross-document, and cross-user reviews. Cover both endpoints and verify no model calls or writes on rejection.

## 2. Autosave can omit the latest edit — P1

Evidence: [use-auto-save.ts](https://github.com/rjwalters/draftwell/blob/e1dff67/src/hooks/use-auto-save.ts#L17) and [DocumentEditPage.tsx](https://github.com/rjwalters/draftwell/blob/e1dff67/src/pages/DocumentEditPage.tsx#L55).

Reproduction: edit A starts saving; type B while the request remains pending; allow B's debounce to expire; complete A. The hook skips B while `isSavingRef` is true and never schedules it again. The same omission occurs when unmounting during A. Both cases were reproduced with controlled promises and fake timers.

Related code findings: the page catches save errors without rejecting, so the hook marks failed content as saved internally. Loading nonempty content is treated as a change from the initial empty string and creates an unnecessary revision. A save completion can show “Saved” while a newer edit is pending.

Acceptance: serialize saves while retaining the newest pending content, propagate failure, provide retry, and track the saved baseline separately. Cover edit-during-save, failed save, navigation, document switching, and no-write-on-load.

## 3. Editing and AI need a shared revision boundary — P1

Evidence: `DocumentEditPage`, `ReviewPanel`, and the content-writing handlers in `functions/lib/documents.ts` and `functions/lib/ai.ts`.

Review can start before autosave completes, so it reads older R2 content. Revision/refinement saves immediately on the server and replaces editor state; edits made during the request can be overwritten. Content updates allocate `current_revision + 1` and write `rev_N.md` without a compare-and-swap check; simultaneous requests can target the same key. The revisions schema has no unique constraint on `(document_id, revision_number)`.

These are code-path findings; concurrent D1/R2 writes were not exercised against a real database.

Acceptance: persist before review, record the source revision/content hash for every run, and reject stale application with a conflict response. Allocate immutable revision objects safely across writers. Keep generated text as a candidate until accepted, retaining the previous revision and change record. Test competing edits and delayed AI completion.

## 4. Review restoration and real diffs are missing — P2

Evidence: [ReviewPanel.tsx](https://github.com/rjwalters/draftwell/blob/e1dff67/src/components/ReviewPanel.tsx) and `DocumentEditPage.tsx`.

The panel initializes empty and never fetches existing reviews on mount. Toggling it off unmounts it; reopening loses the visible review even though list/detail APIs exist. After revision, item refresh retrieves fewer fields than generation: suggestions, source labels, and consensus metadata are not retained in the D1 item representation. `diffView` stores old/new content but renders only the summary.

Acceptance: restore the latest review and offer history; retain metadata through refresh; tie findings to the reviewed revision; show word-level changes and accept/reject actions.

## 5. Standard checks miss backend types and library tests — P2

`tsconfig.json` includes `src` and the nonexistent `workers` directory, omitting `functions`. A temporary backend typecheck exposed the missing Workers AI type. `vitest.config.ts` excludes review-panel because it uses Node's test runner; the root check does not invoke that runner separately. Root installation does not install the nested package's dev dependencies.

Acceptance: add a backend tsconfig, repair the type error, and wire package installation/build/tests into one documented check. All 71 review-panel tests passed once its dependencies were installed.

## 6. Voice profiles do not reach document review/revision — P2

The app can create voice profiles. The review-panel library accepts `options.voiceProfile`, but `handleGenerateReview` calls `reviewDocument(content, { callModel })` without it. Revision/refinement prompts also receive no profile or samples. Creating a profile does not currently personalize these paths.

Acceptance: select a profile per project/document, enforce ownership, load it for every writing phase, and test prompt propagation. Preserve samples as evidence rather than relying only on an inferred profile. Align with Anvil's voice-grounding conventions.

## 7. Documentation and CSS maintenance — P3

README describes an `apps/web` / `packages/api` layout and Typst export; the app uses `src`, Pages Functions, D1/R2, and jsPDF. The MVP checklist understates implemented features. Vite has no API proxy, so `npm run dev` alone is not a documented full-stack setup. WORK_PLAN previously showed closed issue #69 as in progress.

The build emits CSS such as `[loom:curated]{loom:curated}` and `[task:abc123]{task:abc123}` from unrelated repository content. Scope Tailwind discovery to application sources and verify these warnings disappear.

WORK_PLAN has been refreshed. Application fixes, README changes, and GitHub issue creation remain proposed work.
