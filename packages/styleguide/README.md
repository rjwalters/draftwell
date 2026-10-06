# @draftwell/styleguide

Mechanical writing checks for Draftwell's review pipeline. Everything here is regex and text metrics: no model calls, so it runs in milliseconds and gives the same answer every time. The API uses it as a fast pre-check before the model-based review.

It has two independent checkers.

## Anti-slop checker

`check(document, styleguide)` scans a document for patterns typical of machine-written prose and returns a `CheckReport`: every match with its line and column, counts by severity, and a composite `score` from 0 (clean) to 10 (maximum slop).

`defaultStyleguide` combines four rule sets:

| Rules | Source | What they catch |
|---|---|---|
| `bannedPhrases` | `rules/phrases.ts` | Stock phrases and chatbot artifacts ("delve", "it's important to note") |
| `overusedWords` | `rules/words.ts` | Words that are fine alone but signal slop in clusters |
| `styleRules` | `rules/style.ts` | Formatting and style tells: bold abuse, emoji in prose, rhetorical-question openers, synonym cycling, em dashes |
| `structuralRules` | `rules/style.ts` | Document-level metrics: em-dash density, uniform sentence length, triadic lists, balanced antithesis, show-don't-tell, excessive hedging |

Severities are `error` (always wrong), `warning` (suspicious in clusters), `info` and `suggestion`. The score weights them 1.0 / 0.5 / 0.1 / 0.05 and maps the total onto 0–10 with `10 × (1 − e^(−weighted/10))`.

To use a different rule set, build your own `Styleguide` object (`rules` plus `structuralRules`) and pass it to `check`.

## Language discipline

`checkDiscipline(text)` runs rules drawn from three writing guides and returns `Finding`s sorted by position:

- **Orwell** (`orwellRules`): dead metaphors, inflated phrases and jargon, long words where short ones do, passive voice, filler
- **Zinsser** (`zinsserRules`): clutter (redundant pairs, wordy qualifiers), overly formal constructions, sentences over 35 words
- **Ogilvy** (`ogilvyRules`): paragraphs over 150 words, hedging that blurs what the reader should do, constructions nobody would say aloud

`checkAllPasses(text)` runs Zinsser's three revision passes (`zinsserPasses`) separately: cut filler, clarify and humanize, then a reader test. `checkPass(text, pass)` runs a single pass. Every result carries Orwell's sixth rule as its `escapeClause`: break any of these rules sooner than say anything barbarous.

## Usage

```ts
import { check, checkDiscipline, defaultStyleguide } from "@draftwell/styleguide";

const report = check(markdown, defaultStyleguide);
console.log(report.score, report.counts);

const { findings } = checkDiscipline(markdown);
```

Inside this repo, `functions/lib/ai.ts` imports the source directly (`../../packages/styleguide/src/index`) and runs `check` before every model review.

## Development

```bash
pnpm --filter @draftwell/styleguide test    # vitest
pnpm --filter @draftwell/styleguide check   # tsc --noEmit
```

The root `pnpm run check:ci` runs these tests as part of the main Vitest suite.
