# functions/

Draftwell's API, deployed as [Cloudflare Pages Functions](https://developers.cloudflare.com/pages/functions/) alongside the frontend. A single catch-all, `api/[[route]].ts`, receives every `/api/*` request and dispatches it by path and method to handlers in `lib/`.

## Request flow

1. `onRequest` wraps each request in `withDiagnostics` (`lib/diagnostics.ts`). That assigns a request ID, records timing events for each stage (document load, voice load, model call, output parse, candidate save), and turns a thrown `RequestError` into a JSON error response carrying the request ID.
2. `dispatch` matches the route. Everything except `/api/health`, `/api/auth/*` and the Google OAuth endpoints calls `getAuthenticatedUser` and returns 401 without a valid session cookie.
3. Handlers check ownership: a document is reached only through a project the user owns (`verifyProjectOwnership`).

Diagnostics for each request are logged as JSON lines and saved to the `request_diagnostics` table for 14 days. To inspect a request by the reference shown in an API error, run `pnpm run diagnostics -- <request-id>` (see [Troubleshooting](../docs/TROUBLESHOOTING.md)).

## Routes

All project and document routes are under `/api/projects/:projectId`.

| Route | Methods | Handler module |
|---|---|---|
| `/api/health` | GET | `auth.ts` |
| `/api/auth/register`, `/login`, `/logout`, `/refresh` | POST | `auth.ts` |
| `/api/auth/me` | GET, PUT, DELETE | `auth.ts` |
| `/api/auth/google`, `/google/callback` | GET | `google-auth.ts` |
| `/api/projects` | GET, POST | `projects.ts` |
| `/api/projects/:projectId` | GET, PUT, DELETE | `projects.ts` |
| `…/documents` | GET, POST | `documents.ts` |
| `…/documents/:documentId` | GET, PUT, DELETE | `documents.ts` |
| `…/documents/:documentId/ai/draft` | POST | `drafting.ts` |
| `…/documents/:documentId/ai/review` | POST | `ai.ts` |
| `…/documents/:documentId/reviews` | GET | `ai.ts` |
| `…/documents/:documentId/reviews/:reviewId` | GET | `ai.ts` |
| `…/documents/:documentId/reviews/:reviewId/items/:itemId` | PATCH | `ai.ts` |
| `…/documents/:documentId/ai/revise`, `/ai/refine` | POST | `ai.ts` → `candidates.ts` |
| `…/documents/:documentId/candidates/:candidateId/accept` | POST | `candidates.ts` |
| `…/documents/:documentId/ai/score`, `/ai/compare` | POST | `ai.ts` |
| `…/documents/:documentId/writing-check` | POST | `anvil.ts` |
| `/api/voice/profiles` | GET | `voice.ts` |
| `/api/voice/analyze` | POST | `voice.ts` |
| `/api/voice/profiles/:profileId` | GET, DELETE | `voice.ts` |

## Modules

| File | Responsibility |
|---|---|
| `auth.ts` | Email/password registration and login, 7-day sessions in D1, profile updates, account deletion |
| `google-auth.ts` | Google OAuth sign-in (authorization code grant) with identity linking through `oauth_accounts`; returns 503 when the Google secrets are unset |
| `projects.ts` | Project CRUD and `verifyProjectOwnership` |
| `documents.ts` | Document CRUD; content lives in R2, metadata in D1 |
| `revisions.ts` | `saveRevision`: writes each revision as a new R2 object, then advances the document with a D1 compare-and-swap on `baseRevision`. Stale saves get 409; a missing `baseRevision` gets 428. Also defines `RequestError` |
| `ai.ts` | Review generation (runs the `@draftwell/styleguide` checker, then the `@draftwell/review-panel` persona panel), review history and finding status, scoring, version comparison |
| `candidates.ts` | Revise and refine produce a stored *candidate* revision; nothing changes until the user accepts it, which saves the revision and resolves the addressed findings together |
| `drafting.ts` | AI drafting from a prompt |
| `writing-model.ts` | Picks the model for drafting, review and revision: Claude when an API key is available, otherwise the Workers AI binding |
| `pipeline.ts` | Revision and refinement prompts, response parsing, and the Claude API client (routed through AI Gateway when `AI_GATEWAY` is set) |
| `voice.ts`, `writing-voice.ts` | Voice profile analysis from writing samples (Workers AI), and loading a document's selected profile into prompts |
| `anvil.ts` | Proxies the optional writing-check runner at `ANVIL_URL` (see [`services/anvil`](../services/anvil/README.md)) |
| `diagnostics.ts` | Request tracing and persistence, described above |
| `shared.ts`, `types.ts` | JSON and error helpers, cookie handling, the `Env` bindings and row types |

## Models and keys

The Claude key comes from the `x-anthropic-key` request header if present, otherwise from `ANTHROPIC_API_KEY`.

- Drafting, review and revision fall back to Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) when there is no Claude key.
- Scoring and comparison require a Claude key and return 400 without one.
- Voice analysis always uses Workers AI.

## Bindings

Configured in `wrangler.toml`: `DB` (D1), `CONTENT_BUCKET` (R2), `AI` (Workers AI) and `RATE_LIMIT` (KV, bound but not used by any handler yet). Secrets and optional settings (`ANTHROPIC_API_KEY`, `AI_GATEWAY`, `AI_GATEWAY_TOKEN`, Google OAuth, Anvil) are listed in the [root README](../README.md#local-development).

## Tests and type checking

Tests live in `api/__tests__/` and `lib/__tests__/` and run in the root Vitest suite (`pnpm test`). `lib/__tests__/database.ts` gives tests a real SQLite database with the migrations applied (Node's built-in SQLite module, so Node 22.13 or newer).

`tsconfig.functions.json` type-checks this directory against `@cloudflare/workers-types`, and `pnpm run typecheck` includes it.
