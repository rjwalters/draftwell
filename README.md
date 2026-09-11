# Draftwell

Draftwell is an editor for iterative document review. Write in Markdown, get critical feedback, preview a proposed revision, and decide which version to keep.

The application includes projects and documents, email/password and Google sign-in, a Monaco editor with preview and autosave, author voice profiles, persisted reviews, revision proposals with word-level diffs, and PDF export. Accepted revisions are stored as immutable R2 objects with D1 metadata. Saves use a base revision to detect conflicts instead of overwriting newer work.

Author voice can be selected in the editor. Review and revision receive the selected profile and up to three original writing samples. Review history retains suggestions, critic metadata, and finding statuses. Generating a proposal does not change the document or resolve findings; accepting it does both together.

An optional Python adapter uses a pinned [Anvil](https://github.com/rjwalters/anvil) dependency for deterministic rhetoric and numeric checks. It also exposes Anvil's word-level diff and typed evidence payload through its internal API. Draftwell's interactive diff stays local to the browser. Model-driven review/revision still runs through the existing Claude pipeline; migrating those phases into Anvil is a later step.

## Stack and layout

- React 19, TypeScript, Vite, Tailwind, Monaco, and jsPDF.
- Cloudflare Pages Functions for the API, D1 for metadata/auth, R2 for document/review content, Workers AI for voice analysis, and Claude for document review/revision.
- `src/`: frontend; `functions/`: API; `migrations/`: D1 schema.
- `packages/styleguide/` and `packages/review-panel/`: shared TypeScript libraries.
- `services/anvil/`: optional Python writing-check adapter and pinned dependency lock.

## Local development

Use Node 22.13 or newer (the database tests use Node's SQLite module). CI uses Node 24. npm and pnpm workspace lockfiles are provided; the commands below use npm.

```bash
npm ci
npm run db:migrate
npm run build
```

Run the API and frontend in separate terminals:

```bash
# Terminal 1: local Pages Functions, D1, and R2 on port 8788
npm run dev:api
```

```bash
# Terminal 2: Vite frontend on port 5173, proxying /api to port 8788
npm run dev
```

Open `http://localhost:5173`. Local registration and document editing use local D1/R2. `npm run dev` alone does not start the API.

Copy `.dev.vars.example` to `.dev.vars` and fill only the integrations you want to exercise. `.dev.vars` is ignored by git. Never put provider secrets in frontend environment variables.

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Model-driven review and revision |
| `AI_GATEWAY`, `AI_GATEWAY_TOKEN` | Optional Cloudflare AI Gateway routing and authentication |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in; register the matching `/api/auth/google/callback` redirect URI with Google |
| `ANVIL_URL`, `ANVIL_TOKEN` | Optional writing-check runner; see below |

Voice analysis uses the Workers AI binding. Its model is now the supported [`llama-3.3-70b-instruct-fp8-fast`](https://developers.cloudflare.com/changelog/post/2026-05-08-planned-model-deprecations/) variant, replacing the retired model name. Live Google, Workers AI, and Claude flows require their corresponding provider configuration.

## Anvil writing checks

Install [uv](https://docs.astral.sh/uv/) and follow [the runner setup](services/anvil/README.md). The adapter locks Anvil to commit `422a295da45b85d40aa628a01df9c6d2d88e300a` and locks its Python dependencies in `services/anvil/uv.lock`.

The editor's **Check writing** action saves first, then sends the API an expected revision. The API authorizes the document, loads its content, computes a SHA-256 snapshot hash, and calls the runner. Results must match the revision, hash, schema, and pinned Anvil version. No document text is sent to an LLM by this check.

Without a configured runner, normal editing/review still works and Check writing reports that the feature is unavailable. Rhetoric findings are advisory; numeric checks recognize constrained arithmetic patterns, not general factual truth.

## Checks

```bash
npm run check:ci   # app + backend + package types, lint, Vitest, and Node review-panel tests
npm run test:anvil # pinned Python adapter tests, including local HTTP requests
npm run check:all  # both suites
npm run build     # complete typecheck and production frontend build
```

The automated checks include SQLite migration/CAS tests, foreign-review rejection, autosave races and retries, review restoration, proposal acceptance, voice propagation, and adapter snapshot/authentication checks. GitHub Actions runs the application and adapter checks separately.

## Deployment

Apply the schema migrations before deploying this version of the application:

```bash
npm run db:migrate:prod
npm run build
npm run deploy
```

Migration `0004_writing_workflow.sql` adds document voice selection, review metadata, and candidate revisions. The content API now requires a nonnegative integer `baseRevision` on content updates; stale saves return 409 and missing preconditions return 428. Revise/refine returns a proposal, accepted through `POST /api/projects/:projectId/documents/:documentId/candidates/:candidateId/accept`.

Configure production secrets in Cloudflare. The optional Python runner is a separate service; its local server is an integration prototype and production hosting is not included. Deploying the frontend does not provision it.

Local drafts are retained when a save fails. Reopening the document offers an explicit recovery action; conflicts do not silently replace the current server version. Failed saves can be retried or downloaded as Markdown.

## Planning

See [WORK_PLAN.md](WORK_PLAN.md), the [original audit](docs/PROJECT_AUDIT.md), and the [Anvil integration assessment](docs/ANVIL_INTEGRATION.md). The audit records the pre-change state; the work plan tracks implementation.

MIT license.
