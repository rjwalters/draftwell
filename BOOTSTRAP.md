# Bootstrap Instructions for Draftwell

This document guides the next agent on collecting relevant code and patterns from two source repositories to bootstrap the Draftwell project.

## Source Repositories

1. **makefour** (`../makefour`) - Cloudflare Pages app with auth, storage, and Monaco editor
2. **ml-audio-codecs** (`../ml-audio-codecs`) - Document revision pipeline scripts

---

## From makefour: Infrastructure & Frontend

### Priority 1: Cloudflare Configuration

**Files to study:**
- `wrangler.toml` - Cloudflare Pages config with D1, R2, KV bindings
- `package.json` - Build scripts, dependencies (vite, wrangler, drizzle, biome)

**What to adapt:**
- D1 database binding pattern (rename to `draftwell-db`)
- R2 bucket binding (rename to `draftwell-documents`)
- KV namespace for rate limiting
- Build and deploy scripts

### Priority 2: Auth System

**Files to study:**
```
functions/
├── _middleware.ts          # CORS, rate limiting, error handling
├── lib/
│   ├── auth.ts             # Session validation
│   ├── crypto.ts           # Password hashing utilities
│   ├── rateLimit.ts        # KV-based rate limiting
│   └── email.ts            # Email sending (verification, password reset)
└── api/auth/
    ├── register.ts         # User registration
    ├── login.ts            # Session creation
    ├── logout.ts           # Session destruction
    ├── me.ts               # Get current user
    ├── forgot-password.ts  # Password reset request
    ├── reset-password.ts   # Password reset completion
    ├── verify-email.ts     # Email verification
    └── resend-verification.ts
```

**What to adapt:**
- Full auth flow (registration → verification → login → session management)
- Middleware pattern for authenticated routes
- Rate limiting configuration
- Adapt email templates for Draftwell branding

### Priority 3: Database Schema

**Files to study:**
- `schema.sql` - D1 schema (users, sessions tables are relevant)
- `drizzle.config.ts` - Drizzle ORM configuration

**What to adapt:**
- User and session tables (copy directly)
- Remove game-specific tables
- Add new tables for Draftwell:
  ```sql
  -- Projects
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    styleguide_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  -- Documents
  CREATE TABLE documents (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    title TEXT NOT NULL,
    r2_key TEXT NOT NULL,  -- Key in R2 bucket
    current_revision INTEGER DEFAULT 0,
    status TEXT DEFAULT 'draft',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  -- Reviews
  CREATE TABLE reviews (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id),
    revision_number INTEGER NOT NULL,
    r2_key TEXT NOT NULL,  -- Review content in R2
    model TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  -- Review items (individual issues)
  CREATE TABLE review_items (
    id TEXT PRIMARY KEY,
    review_id TEXT NOT NULL REFERENCES reviews(id),
    category TEXT NOT NULL,
    severity TEXT NOT NULL,
    location_start INTEGER,
    location_end INTEGER,
    description TEXT NOT NULL,
    suggestion TEXT,
    status TEXT DEFAULT 'pending'
  );

  -- Revisions
  CREATE TABLE revisions (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id),
    revision_number INTEGER NOT NULL,
    parent_review_id TEXT REFERENCES reviews(id),
    r2_key TEXT NOT NULL,  -- Revised content in R2
    changes_r2_key TEXT,   -- Change summary in R2
    created_at INTEGER NOT NULL
  );
  ```

### Priority 4: Frontend Foundation

**Files to study:**
```
src/
├── main.tsx              # React entry point
├── App.tsx               # Router setup, auth context
├── index.css             # Tailwind base styles
├── contexts/
│   └── AuthContext.tsx   # Auth state management
├── hooks/
│   └── (various)         # Reusable hooks pattern
├── lib/
│   └── utils.ts          # cn() utility for Tailwind
└── components/
    └── ui/               # shadcn/ui components
```

**What to adapt:**
- Auth context and hooks
- Tailwind configuration
- shadcn/ui component setup
- Router structure

**Additional dependencies needed:**
```json
{
  "@monaco-editor/react": "^4.6.0"
}
```

### Priority 5: Build & Dev Tooling

**Files to copy directly:**
- `biome.json` - Linting/formatting config
- `tsconfig.json` and `tsconfig.node.json`
- `postcss.config.js`
- `tailwind.config.js` (adapt colors for Draftwell brand)
- `vite.config.ts`
- `.gitignore`

---

## From ml-audio-codecs: Revision Pipeline

### Priority 1: Core Scripts

**Files to study and adapt:**
```
scripts/
├── utils.py              # Shared utilities (ESSENTIAL)
├── section_utils.py      # Section-based processing (ESSENTIAL)
├── critical-review.py    # Review generation
├── generate-revision.py  # Revision generation with tracking
└── summarize.py          # Document summarization (optional)
```

### Priority 2: Key Patterns from utils.py

**Functions to port to TypeScript:**

1. `estimate_tokens(text)` - Rough token count for chunking
   ```typescript
   function estimateTokens(text: string): number {
     return Math.ceil(text.length / 4);
   }
   ```

2. `run_claude(prompt, model)` - Call Claude API
   - Replace with direct Anthropic API calls in Worker
   - Use raw fetch for Workers compatibility

3. `detect_format(path)` - Detect markdown vs LaTeX
   - Keep for supporting both formats

### Priority 3: Key Patterns from section_utils.py

**Data structures to port:**

```typescript
interface Section {
  heading: string;
  level: number;      // 1 = #, 2 = ##, etc.
  content: string;
  startLine: number;
  tokens: number;
}

interface Chunk {
  sections: Section[];
  chunkId: number;
  content: string;    // Computed: sections joined
  tokens: number;     // Computed: sum of section tokens
}

interface DocumentStructure {
  format: 'markdown' | 'latex';
  sections: Section[];
  frontmatter: string;
  toc: string;        // Generated table of contents
  overview: string;   // AI-generated overview
}
```

**Functions to port:**

1. `parse_document(content, format)` - Parse into sections
2. `chunk_sections(sections, target_tokens)` - Group by token budget
3. `generate_overview(structure)` - Create document overview for context
4. `build_chunk_context(chunk, structure)` - Context window for chunk processing

### Priority 4: Prompts

**From critical-review.py - The review prompt structure:**
- Overall Assessment
- Strengths (3-5 numbered)
- Weaknesses / Open Questions (3-5 numbered)
- Risk Assessment (table format)
- Comparison to Alternatives
- Where This Is Actually "New"
- Recommendations for Strengthening
- Bottom Line

**From generate-revision.py - The revision prompt guidelines:**
- Address actionable criticisms
- Preserve structure
- Maintain voice
- Minimal changes
- Be transparent about what couldn't be addressed

**Output format for revisions:**
```markdown
## Change Summary

### Addressed
- [List each criticism addressed and how]

### Partially Addressed
- [Criticisms that could only be partially addressed, with explanation]

### Not Addressed
- [Items that couldn't be addressed, with reasoning]

---

[REVISED DOCUMENT HERE]
```

### Priority 5: Styleguide System (NEW)

This doesn't exist in ml-audio-codecs yet - design from scratch:

```typescript
interface Styleguide {
  id: string;
  name: string;
  voice: {
    perspective: 'first-person' | 'second-person' | 'third-person';
    tone: string;
    audience: string;
  };
  antiTropes: {
    bannedPhrases: string[];
    bannedPatterns: Array<{
      pattern: string;  // Regex
      replacementHint: string;
    }>;
    structuralRules: string[];
  };
  domainTerms: {
    preferred: Record<string, string[]>;
  };
  formatting: {
    maxSentenceLength?: number;
    maxParagraphLength?: number;
    headingStyle?: 'sentence-case' | 'title-case';
  };
}
```

**Default banned phrases:**
- "dive into", "delve into"
- "it's important to note", "it's worth noting"
- "at the end of the day"
- "first and foremost"
- "in conclusion"
- "leverage" (when "use" works)
- "utilize" (when "use" works)
- "robust and scalable"
- "seamlessly"
- "cutting-edge", "state-of-the-art"
- "game-changer"
- "harness the power"

---

## Recommended Bootstrap Order

### Phase 1: Infrastructure

1. Copy build tooling from makefour:
   - `package.json` (strip game-specific deps)
   - `biome.json`, `tsconfig.json`, etc.
   - `vite.config.ts`

2. Set up Cloudflare:
   - Create `wrangler.toml` with D1, R2, KV
   - Create initial `schema.sql`
   - Set up `functions/_middleware.ts`

3. Copy auth system:
   - `functions/lib/auth.ts`, `crypto.ts`, `rateLimit.ts`
   - `functions/api/auth/*`
   - `src/contexts/AuthContext.tsx`

### Phase 2: Core UI

1. Set up frontend:
   - Copy Tailwind config, shadcn setup
   - Create basic layout components
   - Implement auth pages (login, register)

2. Add Monaco editor:
   - Install `@monaco-editor/react`
   - Create document editor component
   - Add markdown syntax highlighting

3. Basic document CRUD:
   - Create project/document API endpoints
   - R2 storage for document content
   - Document list and selection UI

### Phase 3: Revision Pipeline

1. Port Python logic to TypeScript:
   - `section_utils.py` → `functions/lib/pipeline.ts`
   - Token estimation, chunking, parsing

2. Create AI worker:
   - `functions/api/ai/review.ts` - Generate review
   - `functions/api/ai/revise.ts` - Generate revision
   - `functions/api/ai/refine.ts` - Refine partial items

3. Review tracking UI:
   - Review items panel
   - Status tracking (pending/addressed/partial/rejected)
   - Diff view for revisions

### Phase 4: Polish

1. Styleguide system:
   - Default styleguide with anti-tropes
   - Pre/post validation of content
   - LLM-ness scoring

2. PDF export:
   - Evaluate Typst WASM vs external service
   - Implement export endpoint

3. Preview pane:
   - Live markdown rendering
   - Optional PDF preview

---

## Target File Structure

```
draftwell/
├── README.md
├── BOOTSTRAP.md
├── package.json
├── wrangler.toml
├── schema.sql
├── biome.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js
├── index.html
├── .gitignore
├── functions/
│   ├── _middleware.ts
│   ├── lib/
│   │   ├── auth.ts
│   │   ├── crypto.ts
│   │   ├── rateLimit.ts
│   │   ├── storage.ts
│   │   ├── pipeline.ts
│   │   └── styleguide.ts
│   └── api/
│       ├── auth/
│       ├── projects/
│       ├── documents/
│       ├── reviews/
│       └── ai/
│           ├── review.ts
│           ├── revise.ts
│           └── refine.ts
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── index.css
│   ├── contexts/
│   │   └── AuthContext.tsx
│   ├── components/
│   │   ├── ui/
│   │   ├── Editor.tsx
│   │   ├── Preview.tsx
│   │   ├── ReviewPanel.tsx
│   │   └── DocumentList.tsx
│   └── pages/
│       ├── Home.tsx
│       ├── Login.tsx
│       ├── Register.tsx
│       ├── Projects.tsx
│       └── Editor.tsx
└── packages/
    └── styleguide/
        ├── index.ts
        ├── defaults.ts
        └── validator.ts
```

---

## Commands to Get Started

```bash
cd ../draftwell

# Initialize
pnpm init

# Core dependencies
pnpm add react react-dom react-router-dom @monaco-editor/react zod
pnpm add -D typescript vite @vitejs/plugin-react wrangler
pnpm add -D @cloudflare/workers-types @types/react @types/react-dom
pnpm add -D tailwindcss postcss autoprefixer @biomejs/biome
pnpm add -D drizzle-orm drizzle-kit

# Tailwind
pnpm dlx tailwindcss init -p

# Cloudflare setup
pnpm wrangler login
pnpm wrangler d1 create draftwell-db
pnpm wrangler r2 bucket create draftwell-documents
pnpm wrangler kv namespace create RATE_LIMIT
```

---

## Key Decisions for Next Agent

1. **Anthropic API**: Use raw fetch for Workers compatibility (not the SDK)

2. **PDF generation**: Research Typst WASM maturity; fallback to external service if needed

3. **Real-time preview**: Client-side with `react-markdown` (simpler than server-side)

4. **Figure/image blocks**: Parse and validate syntax only; defer generation to future

5. **Versioning**: Track in D1 for queryability; store content in R2
