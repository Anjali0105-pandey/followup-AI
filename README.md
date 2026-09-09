# FollowUp AI

An AI sales assistant that answers one question every morning: **what should I do next, and why?**

> Never forget a customer, commitment, or next action.

## The core loop

```
Meeting  →  AI extracts commitments, questions and signals
         →  dated follow-ups created
         →  priority scored, with reasons
         →  Command Center surfaces the action
         →  AI drafts the message
         →  sent, logged, re-scored
```

## Running it

```bash
npm install
npm run seed     # builds a 15-customer demo workspace, dates relative to today
npm run dev
```

Open http://localhost:3000.

**AI works without an API key.** Extraction and drafting run on local rule-based
generation so every screen is demoable out of the box. Set `GEMINI_API_KEY` in
`.env.local` and the same code paths switch to Gemini 2.5 Flash — no other change.

## Structure

| Path | What lives there |
|---|---|
| `app/(app)/` | Screens. Server Components by default |
| `app/actions.ts` | Every mutation, as Server Actions |
| `lib/db.ts` | SQLite schema (v2, nine tables) |
| `lib/repo/` | Repositories — the only place SQL is written |
| `lib/priority.ts` | Deterministic priority model with explainable reasons |
| `lib/insights.ts` → `lib/repo/insights.ts` | The eight insight lenses, computed on read |
| `lib/ai.ts` | Model calls, with rich mock fallbacks |
| `lib/ask.ts` | Natural-language intent router |
| `lib/seed/` | Demo dataset |
| `components/` | Shared UI, shell, generator drawer |

## Design rules that are load-bearing

- **Nothing is ranked without a reason.** Every priority score emits the
  human-readable reasons that produced it, and the UI shows them.
- **AI-authored content is always marked** (✦ and violet). The rep can always
  tell what a machine wrote.
- **No model call on a list page load.** Scores and insights are computed on
  write and read from cache.
- **All SQL goes through `lib/repo/*`**, so swapping SQLite for a real backend
  doesn't touch the UI.

See [implementation plan.md](implementation%20plan.md) for the full architecture,
the phase-by-phase build, and the build log.
