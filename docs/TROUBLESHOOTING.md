# Troubleshooting production requests

Every API response includes an `X-Request-ID` header. JSON error responses also
include `requestId`; the editor and review panel show it as **Reference** in the
error message. Ask for this reference and the action that failed.

Read recent AI requests and server failures:

```sh
npm run diagnostics
```

Look up the full trace for a reference:

```sh
npm run diagnostics -- 00000000-0000-4000-8000-000000000000
```

The command uses the existing Wrangler login and production D1 database. Add
`--local` to query the local development database. There is no public diagnostic
endpoint.

Records contain the normalized route, document ID when present, HTTP status,
duration, safe error category, and AI stage events. Stage events capture provider
and model, input/output character counts, token budget, available finish reason,
attempt number, output marker presence, parse failures, retries, and candidate
storage. They do not contain prompts, draft text, generated text, titles, emails,
cookies, credentials, query strings, or raw upstream error messages.

For a drafting failure, inspect `document.load`, `content.load`, `voice.load`,
`model`, `output.parse`, and `candidate.save` in order. For example:

- `model` failure with provider status 429: provider throttling.
- `output.parse` failure with `incomplete_output`: the model omitted required
  document/summary markers; check the finish reason and retry event.
- `invalid_summary`: the document arrived but the change summary was invalid.
- `candidate.save` with `database_schema`: inspect applied D1 migrations.

`request_diagnostics` retains AI operations and HTTP 5xx failures. Records older
than 14 days are pruned on the next retained request. Persistence runs through
`waitUntil` and is best effort: database or runtime outages can prevent retention.
A logging failure never changes the original API response.

Live logs emit JSON `request.stage`, `request.completed`, and
`diagnostics.persist_failed` events. Tail the current deployment URL:

```sh
npx wrangler pages deployment list --project-name draftwell
npx wrangler pages deployment tail <deployment-url> --project-name draftwell --format pretty
```

Cloudflare Pages [does not retain its live log stream](https://developers.cloudflare.com/pages/functions/debugging-and-logging/).
The D1 history therefore matters when troubleshooting after an incident. Server
source-map upload is enabled for platform stack traces. Neither history nor
request IDs can reconstruct failures that happened before this instrumentation
was deployed.
