# @draftwell/review-panel

Model-based document review for Draftwell: a panel of reviewer personas, calibrated scoring, and head-to-head comparison of document versions. Every entry point takes a `callModel: (prompt: string) => Promise<string>` function, so the caller decides which model, key and gateway to use. `createCallModel` (below) is an optional helper that builds one for the Anthropic Messages API.

## Multi-persona review

`reviewDocument(document, options)` runs each persona against the document in parallel, then clusters their findings and ranks them by agreement.

| Persona | Looks at |
|---|---|
| Critical Editor | Structure, logical flow, clarity of argument, redundancy |
| Domain Expert | Technical accuracy, terminology, completeness |
| General Reader | Accessibility for a first-time, non-expert reader: can they follow the argument without getting lost or bored |
| Style Reviewer | Consistent voice and tone; personalized by `options.voiceProfile` when one is supplied |

Findings from different personas are treated as the same issue when their descriptions overlap enough by word-level Jaccard similarity, with a boost when the category or location also matches. The returned `AggregatedReview` separates `consensusItems` (at least `consensusThreshold` of the personas agree, default 0.75) from `disagreements`, which need an editor's judgment. Pass `options.personas` to use your own panel.

```ts
import { reviewDocument } from "@draftwell/review-panel";

const review = await reviewDocument(markdown, {
  callModel: (prompt) => callClaude(prompt),
  voiceProfile, // optional
});
```

## Calibrated scoring

`scoreDocument(content, documentId, revision, callModel)` asks a judge model for a 1–10 score on six dimensions in `SCORING_DIMENSIONS`: clarity, structure, voice, completeness, evidence and specificity, and concision. Each dimension carries calibration anchors that describe what a given score means, and every score must come with quoted evidence of a weakness, which keeps scores from drifting upward. `computeOverallScore` takes an optionally weighted mean.

`ScoreLog` keeps scores in memory across revision cycles to show whether revisions are improving the document. It doesn't persist anything; the API stores scores in D1 itself.

## Version comparison

`compareDocuments(versionA, versionB, callModel)` has a judge pick the better of two versions with reasoning. `EloRanking` and `updateEloRatings` turn those pairwise results into ratings (starting at 1500, K-factor 32).

## Model configuration

`DEFAULT_MODEL_CONFIG` separates a writer role (higher temperature) from a judge role (lower temperature). `createModelConfig` merges overrides, and `createCallModel(roleConfig, apiKey, baseUrl?)` returns a `callModel` that posts to the Anthropic Messages API (`baseUrl` defaults to `https://api.anthropic.com`). The Draftwell API doesn't use these helpers. It picks its provider in `functions/lib/` and passes its own `callModel`.

## Usage in this repo

`functions/lib/ai.ts` imports the source directly (`../../packages/review-panel/src/...`) for `reviewDocument`, `scoreDocument`, `compareDocuments` and `EloRanking`. `functions/lib/writing-voice.ts` uses the `VoiceProfileRules` type.

## Development

The tests use Node's built-in test runner against the compiled output, so build first:

```bash
pnpm --filter @draftwell/review-panel run build   # tsc → dist/
pnpm --filter @draftwell/review-panel test        # node --test dist/test/*.test.js
pnpm --filter @draftwell/review-panel check       # tsc --noEmit
```

The root `pnpm run test:panel` runs the build and test steps, and `pnpm run check:ci` includes it. The root Vitest suite excludes this package.
