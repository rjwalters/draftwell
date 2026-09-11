# Work Plan

Updated 2026-09-11. Implemented on `improve/writing-workflow`. The branch includes GitHub main and preserves the original local settings commit.

| Priority | Work | Status |
|---|---|---|
| P1 | Enforce review ownership in revise/refine | Implemented; foreign and unrelated review regression tests |
| P1 | Reliable autosave and recovery | Implemented; serialized saves, retries, flush before review, unload guard, local draft recovery, race tests |
| P1 | Protect revision history and coordinate AI with editing | Implemented; unique R2 objects, transactional compare-and-swap, candidate revisions, explicit acceptance, conflict tests |
| P2 | Restore reviews and show word-level diffs | Implemented; history selector, metadata retention, proposal preview, acceptance tests |
| P2 | Check the entire application | Implemented; backend/package types, SQLite behavior tests, review-panel tests, separate Python CI job |
| P2 | Connect voice profiles to document review/revision | Implemented; per-document selection, ownership checks, profile rules and exemplar propagation |
| P2 | Prove a pinned Anvil integration | Implemented; Python dependency/lock, authenticated runner, snapshot-bound API, editor checks, diff/evidence contract, tests |
| P3 | Update setup docs and CSS scanning | Implemented; actual architecture and commands, environment example, scoped Tailwind sources |

Deployment prerequisites: apply `0004_writing_workflow.sql` and configure provider secrets. The optional Anvil runner needs its own host and shared token; frontend deployment does not provision it. Local setup is documented in [README.md](README.md).

Later work, beyond the initial adapter:

- Move model-driven writing phases behind a persisted job interface with cancellation and bounded iteration.
- Add editable Anvil-style purpose/audience/rubric and full voice grounding documents.
- Evaluate user drafts for usefulness, false positives, voice preservation, cost, and latency before retiring duplicated TypeScript packages.
- Contribute to Anvil's unfinished cross-version claim ledger if the product needs persistent verification.

Historical baseline: [Project audit](docs/PROJECT_AUDIT.md). Architecture direction: [Anvil integration assessment](docs/ANVIL_INTEGRATION.md).
