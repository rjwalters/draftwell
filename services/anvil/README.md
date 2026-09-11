# Anvil adapter

This is the first runtime integration between Draftwell and Anvil. It uses a pinned Git dependency and locked Python dependencies. It runs deterministic rhetoric/numeric checks and can return word-level diffs. It does not execute agent commands, model calls, source verification, or a revision loop.

## Run locally

With uv installed:

```bash
uv sync --project services/anvil --frozen
export ANVIL_TOKEN='choose-a-local-development-token'
uv run --project services/anvil --frozen python services/anvil/server.py
```

The server binds to `127.0.0.1:8790`. Set `ANVIL_URL=http://127.0.0.1:8790` and the same `ANVIL_TOKEN` in Draftwell's ignored `.dev.vars`, then restart the Pages development server. `ANVIL_HOST` and `ANVIL_PORT` override the listener explicitly. The server refuses to start without a token.

This standard-library HTTP server is a local integration prototype. Production deployment needs a managed Python service behind TLS or a private network, with process supervision and request/resource limits. It is not deployed by `npm run deploy`.

## Contract

`POST /check`, authenticated with `Authorization: Bearer <ANVIL_TOKEN>`:

```json
{
  "schema_version": "1",
  "document_id": "document-uuid",
  "revision": 2,
  "content_hash": "<sha256 of UTF-8 content>",
  "content": "Markdown body",
  "previous_content": "Optional earlier body for a word-level diff"
}
```

The request rejects unknown fields, caller-selected filesystem paths, hash mismatches, invalid IDs/revisions, and text beyond 100,000 characters. Content comes from the authenticated Draftwell API's immutable R2 snapshot. The browser never receives the runner token.

The response contains the same identity and hash, `anvil_commit`, `rhetoric`, `numeric`, an upstream typed `review` evidence payload, and an optional structured `diff`. Rhetoric and numeric findings remain advisory in this initial integration. The diff contains Anvil's escaped HTML fragments; the current frontend uses its own React-rendered diff and does not inject these fragments.

## Tests and upgrades

```bash
npm run test:anvil
```

Tests cover arithmetic evidence, schema compatibility, word diff, rhetoric, hash/path rejection, authorization, and a real local HTTP round trip. Application-side tests additionally reject stale or incompatible runner results.

To upgrade Anvil, change the exact source commit in `pyproject.toml`, `adapter.py`, and `functions/lib/anvil.ts`; regenerate `uv.lock`; then run both application and adapter tests. Keep source and dependency pins in reviewable changes. The current pin is `422a295da45b85d40aa628a01df9c6d2d88e300a` (source version 0.11.5).

Anvil is MIT-licensed. It remains a separate installed dependency; no upstream source has been copied into Draftwell.
