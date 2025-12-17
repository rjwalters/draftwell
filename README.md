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
│  │   Editor    │  │  (Live PDF) │  │   - Issue tracking  │ │
│  │             │  │             │  │   - Status updates  │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   Cloudflare Workers                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐ │
│  │   Auth   │  │  Storage │  │   PDF    │  │ AI Pipeline │ │
│  └──────────┘  └──────────┘  └──────────┘  └─────────────┘ │
└─────────────────────────────────────────────────────────────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
         ┌────────┐   ┌──────────┐   ┌──────────┐
         │   R2   │   │  Claude  │   │  Typst   │
         │Storage │   │   API    │   │  (PDF)   │
         └────────┘   └──────────┘   └──────────┘
```

### Stack

- **Frontend**: Monaco editor, React, Tailwind
- **Backend**: Cloudflare Workers
- **Storage**: Cloudflare R2 (documents, revisions, assets)
- **Auth**: Cloudflare Access or OAuth
- **AI**: Claude API (review, revision, refinement)
- **PDF**: Typst (fast, modern LaTeX alternative with WASM support)

## MVP Scope

### Included

- [ ] Monaco editor with markdown + figure/image syntax highlighting
- [ ] Project/document management (single user)
- [ ] Authentication
- [ ] R2 storage with version history
- [ ] Critical review generation
- [ ] Revision generation with change tracking
- [ ] Refinement loop for partial issues
- [ ] Basic styleguide with anti-trope validation
- [ ] PDF export

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

# Run development server
pnpm dev

# Deploy to Cloudflare
pnpm deploy
```

## Project Structure

```
draftwell/
├── apps/
│   └── web/              # Frontend application
├── packages/
│   ├── api/              # Cloudflare Workers
│   ├── styleguide/       # Styleguide validation
│   └── shared/           # Shared types and utilities
├── docs/                 # Documentation
└── examples/             # Example documents and styleguides
```

## License

MIT
