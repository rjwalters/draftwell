# Draftwell

**Iterative document refinement with AI-powered critical review.**

Draftwell treats revision as a first-class workflow. Instead of using AI as a ghostwriter, it acts as your critical reader—identifying issues, suggesting improvements, and tracking what's been addressed across multiple revision passes.

## Core Concepts

### The Revision Pipeline

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Draft     │ ──▶ │  Critical Review │ ──▶ │    Revision     │
│  (markdown) │     │  (structured     │     │  (with change   │
│             │     │   critique)      │     │   tracking)     │
└─────────────┘     └──────────────────┘     └────────┬────────┘
                                                      │
                              ┌────────────────────────┘
                              ▼  (if issues remain)
                    ┌─────────────────┐
                    │   Refinement    │──┐
                    │   (targeted)    │  │
                    └─────────────────┘  │
                              ▲          │
                              └──────────┘
```

1. **Critical Review**: AI generates structured critique with tracked issues
2. **Revision**: AI proposes changes, marking each issue as Addressed / Partially Addressed / Not Addressed
3. **Refinement**: Iterate on remaining issues until satisfied

### Styleguide & Anti-Trope Protection

Documents are validated against a configurable styleguide that enforces:

- **Voice and tone** consistency
- **Banned phrases** ("dive into", "it's important to note", "leverage", etc.)
- **Structural rules** (no rhetorical questions to start sections, no filler transitions)
- **Domain terminology** standardization

The goal: your refined document should read like *you* wrote it, not like an LLM wrote it.

### Figure & Image Descriptions

Figures and images are described inline using fenced divs:

```markdown
::: {#system-architecture .figure}
**System architecture showing data flow**

A horizontal flow diagram with three tiers:
- Top: User-facing components (Editor, Preview, Review Panel)
- Middle: API layer (Auth, Storage, PDF, AI Pipeline)
- Bottom: External services (R2, Claude, Typst)

- **style**: technical-diagram
- **renderer**: tikz | mermaid
:::
```

These remain as structured descriptions in source, with optional rendering to actual diagrams.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Web Application                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │   Monaco    │  │   Preview   │  │   Review Panel      │ │
│  │   Editor    │  │ +PDF export │  │   - Issue tracking  │ │
│  │             │  │             │  │   - Status updates  │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   Cloudflare Workers                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐ │
│  │   Auth   │  │  Storage │  │  Voice   │  │ AI Pipeline │ │
│  └──────────┘  └──────────┘  └──────────┘  └─────────────┘ │
└─────────────────────────────────────────────────────────────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
         ┌────────┐   ┌──────────┐   ┌──────────┐
         │ D1/R2  │   │  Claude  │   │ Workers  │
         │Storage │   │   API    │   │    AI    │
         └────────┘   └──────────┘   └──────────┘
```

### Stack

- **Frontend**: React 19, Vite, Tailwind, Monaco editor
- **Backend**: Cloudflare Pages Functions (`functions/`)
- **Storage**: Cloudflare D1 (users, projects, documents, reviews, scores), R2 (document and revision content), KV (rate limiting)
- **Auth**: Email/password sessions plus Google OAuth sign-in
- **AI**: Claude API (review, revision, refinement, scoring) and Workers AI, optionally routed through Cloudflare AI Gateway
- **PDF**: Client-side export with jsPDF

## MVP Scope

### Included

- [x] Monaco markdown editor with live preview and auto-save
- [ ] Figure/image syntax highlighting in the editor
- [x] Project/document management (single user)
- [x] Authentication
- [x] R2 storage with version history
- [x] Critical review generation
- [x] Revision generation with change tracking
- [x] Refinement loop for partial issues
- [x] Basic styleguide with anti-trope validation
- [x] PDF export

### Deferred

- Multi-user collaboration
- Real-time co-editing
- Custom styleguide editor UI
- Figure/image generation (keep as descriptions for MVP)
- Version branching
- Comments and annotations
- Team workspaces

## Development

```bash
# Install dependencies
pnpm install

# Apply D1 migrations locally
pnpm db:migrate

# Run development server
pnpm dev

# Lint, typecheck, and test
pnpm check:all

# Deploy to Cloudflare Pages (`pnpm deploy` is a pnpm built-in, so use `run`)
pnpm run deploy
```

## Project Structure

```
draftwell/
├── src/                  # React frontend (pages, components, hooks)
├── functions/
│   ├── api/              # Pages Functions API router ([[route]].ts)
│   └── lib/              # Auth, projects, documents, AI pipeline, voice profiles
├── migrations/           # D1 schema migrations
├── packages/
│   ├── styleguide/       # Anti-slop styleguide and language discipline rules
│   └── review-panel/     # Multi-persona review, scoring, and Elo comparison
└── public/               # Static assets
```

## License

MIT
