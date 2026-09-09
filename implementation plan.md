# FollowUp AI — Product Architecture & Implementation Plan

> **Status: Phases 1–11 built and running.** Every phase below is marked with its
> outcome. Deviations discovered during implementation are recorded inline
> rather than quietly edited out of the plan.
> Stack in place today: Next.js 16 (App Router), React 19, Tailwind v4, better-sqlite3,
> `@google/genai` (Gemini 2.5 Flash) behind `lib/ai.ts` with an automatic mock mode when
> `GEMINI_API_KEY` is absent.

---

## 0. Where we are today (honest baseline)

| Area | Current state |
|---|---|
| Navigation | Thin top bar: `Today`, `All customers`, `+ Add meeting`, `/` Ask popover |
| Screens | `/` (digest), `/customers`, `/customers/[id]`, `/upload` |
| Data model | 2 tables: `customers`, `meetings`. Facts stored as a JSON blob string |
| AI | `extractMeeting`, `suggestFollowUp`, `scoreCustomer`, `generateMessage`, `answerQuestion`, `refineMessage`, `disambiguateCustomer` |
| Scoring | `lib/scoring.ts` — one AI call + one hardcoded high-value rule |
| Visual | Default Tailwind/Geist scaffold, `max-w-3xl`, black-on-white, dark-mode auto |
| Demo data | Effectively empty → the app reads as a to-do list with nothing in it |

**Core diagnosis:** the product's *value* is prioritized judgment ("what do I do next, and why"),
but the *structure* is a customer list with a note attached. The data model has no first-class
notion of an opportunity, a commitment, an interaction channel, or a follow-up task — so the UI
can only ever render "customer + date". Every visual fix on top of that stays cosmetic.

**Therefore this is a rebuild, not a restyle.** The data model is Phase 1, not Phase 9.

---

## 1. Product thesis

**Promise:** *Never forget a customer, commitment, or next action.*

**The one question every screen answers:** *What should I do next, and why?*

**The core loop we optimize for — everything else is deprioritized:**

```
INTERACTION (meeting / call / email / WhatsApp)
   ↓ AI extracts: facts, commitments, questions, signals, next steps
COMMITMENTS + FOLLOW-UPS created automatically
   ↓ AI scores priority with an explainable reason
COMMAND CENTER surfaces the ranked action
   ↓ AI drafts the actual message
REP SENDS → marks done
   ↓ outcome feeds back into customer memory
NEXT ACTION RECOMMENDED
```

### Product judgment calls (deviations from the raw feature list)

These are deliberate — a startup ships the loop, not the org chart.

1. **Inbox is deferred to Phase 9 and reframed.** A real unified inbox needs Gmail/WhatsApp
   OAuth, sync, threading, and dedup — that is a product of its own. Until channels are
   connected an "Inbox" is a fake screen. We ship **Interactions** (a manual/pasted log that
   already powers the timeline) in Phase 3, and upgrade it to a live Inbox once a channel
   connector exists. Sidebar shows Inbox with a "Connect a channel" state, not fake mail.
2. **Analytics is deferred to Phase 10.** Zero value at low data volume; it is a
   retention/manager feature, not an activation feature.
3. **Tasks and Commitments are one page, not two.** A "task" with no counterparty is just a
   commitment you owe. Splitting them creates two half-empty screens and forces the rep to
   guess which one to check. Page: **Commitments**, tabs `You owe / Customer owes / Done`.
4. **Follow-ups and Commitments share one entity.** A follow-up *is* a commitment with
   `owner = me`. Two tables would drift out of sync instantly. One `commitments` table with an
   `owner` discriminator; the Follow-ups page is a saved view over it.
5. **AI Insights is a lens, not a store.** Insights are derived queries over opportunities +
   interactions, computed on read and cached — never a table a human maintains.
6. **Meeting Intelligence is the wedge.** Paste a transcript → get commitments and follow-ups
   for free. This is the single highest-leverage demo moment; it gets the most polish budget.
7. **Kanban before list for Opportunities.** Reps think in stages. List view is a toggle.
8. **Deal Risk Detection is not a page** — it is a signal rendered inline everywhere an
   opportunity appears. A separate "risk" screen is a screen nobody opens.

**Personality:** intelligent, calm, fast, proactive. Not a spreadsheet, not a CRM, not a chat wrapper.

---

## 2. Information architecture

```
┌────────────────────┬───────────────────────────────────────────────┐
│ SIDEBAR (240px)    │ TOP BAR: breadcrumb · ⌘K Ask · + New · avatar │
│  ── WORK ──        ├───────────────────────────────────────────────┤
│  Command Center  ⌘1│                                               │
│  Follow-ups      ⌘2│   PAGE CONTENT   (max-w-[1200px], centered)   │
│  Commitments     ⌘3│                                               │
│  Meetings        ⌘4│                                               │
│  ── PIPELINE ──    │                                               │
│  Customers       ⌘5│                                               │
│  Opportunities   ⌘6│                                               │
│  ── INTELLIGENCE ──│                                               │
│  AI Insights     ⌘7│                                               │
│  Inbox        (soon)│                                              │
│  Analytics    (soon)│                                              │
│  ─────────────────  │                                              │
│  [avatar] Rahul S.  │                                              │
│  Acme Sales · Free  │                                              │
│  Settings           │                                              │
└────────────────────┴───────────────────────────────────────────────┘
```

**Route map**

| Route | Screen | Notes |
|---|---|---|
| `/` | Command Center | default landing |
| `/followups` | Follow-ups | `?tab=today\|overdue\|upcoming\|waiting\|done` |
| `/commitments` | Commitments | `?tab=owed\|theirs\|done` |
| `/meetings` | Meetings list | |
| `/meetings/new` | Add meeting / paste transcript | replaces `/upload` |
| `/meetings/[id]` | Meeting intelligence + extracted actions | |
| `/customers` | Customer list | |
| `/customers/[id]` | **Customer 360** | tabs: Overview · Timeline · Intel · Commitments |
| `/opportunities` | Pipeline (kanban ⇄ list) | |
| `/opportunities/[id]` | Opportunity detail | may render as drawer over pipeline |
| `/insights` | AI Insights | |
| `/inbox` | Inbox | Phase 9 — connect-channel state before then |
| `/analytics` | Analytics | Phase 10 |
| `/settings` | Settings + integrations | |
| `/onboarding` | 5-step setup | Phase 11 |

**Global overlays** (not routes — state, so they open over any page):
`⌘K` Command palette / Ask · Follow-up Generator drawer · Quick-add · Toasts.

---

## 3. Data model

Nine entities. Everything on every screen is a projection of these.

```
User ──┬─< Customer ──< Contact
       │       │
       │       ├──< Opportunity ──< Commitment
       │       │         │
       │       │         └──< Interaction ──< Signal
       │       │                    │
       │       │                    └── Meeting (interaction subtype, +transcript)
       │       └──< Insight (derived)
       └── Workspace
```

### 3.1 Tables (SQLite; migrated additively in `lib/db.ts`, same pattern as today)

```sql
-- workspace / user ---------------------------------------------------
users(id, name, email, role, avatar_seed, workspace_id, created_at)
workspaces(id, name, plan, created_at)

-- customers & contacts ------------------------------------------------
customers(
  id, workspace_id, name, company, industry, website, segment,
  health TEXT,                    -- healthy | watch | at_risk
  ai_summary TEXT,                -- rolling AI memory of the account
  facts TEXT DEFAULT '{}',        -- kept from v1, still the durable KV memory
  owner_user_id, created_at, updated_at
)
contacts(
  id, customer_id, name, role, email, phone,
  is_decision_maker INT, is_champion INT, notes, created_at
)

-- pipeline -------------------------------------------------------------
opportunities(
  id, customer_id, name, value REAL, currency,
  stage TEXT,                     -- new|qualified|discovery|demo|proposal|negotiation|won|lost
  probability INT,                -- 0..100
  expected_close_date, primary_contact_id,
  priority_score INT,             -- 0..100, cached
  priority_band TEXT,             -- critical|high|medium|low
  priority_reasons TEXT DEFAULT '[]',   -- ["$25K deal","overdue 2d","buying signal"]
  risk_reasons TEXT DEFAULT '[]',
  last_interaction_at, next_action_at,
  created_at, updated_at
)

-- everything that happened ---------------------------------------------
interactions(
  id, customer_id, opportunity_id, contact_id,
  type TEXT,                      -- meeting|call|email|whatsapp|linkedin|proposal|note|sms
  direction TEXT,                 -- inbound|outbound
  occurred_at, subject, body, transcript,
  ai_summary, ai_processed_at,
  created_at
)
signals(
  id, interaction_id, opportunity_id,
  kind TEXT,                      -- buying|risk|objection|question|competitor|budget|timeline
  label, detail, strength INT,    -- 1..3
  resolved_at, created_at
)

-- the signature feature -------------------------------------------------
commitments(
  id, customer_id, opportunity_id, contact_id, interaction_id,
  owner TEXT,                     -- me | customer     ← unifies follow-ups & promises
  kind TEXT,                      -- call|email|whatsapp|send_proposal|send_pricing|
                                  --   answer_question|schedule_meeting|wait|escalate
  title, detail,
  due_date, status TEXT,          -- open|snoozed|done|cancelled
  snoozed_until, completed_at,
  source TEXT,                    -- ai_extracted | manual
  priority_band, created_at
)

-- derived, cached -------------------------------------------------------
insights(
  id, workspace_id, category TEXT,   -- hot|at_risk|going_cold|buying_signal|
                                     --   unanswered_question|missed_followup|no_next_step|waiting_on_us
  customer_id, opportunity_id,
  title, why TEXT, recommendation TEXT, severity TEXT,
  computed_at, dismissed_at
)
generated_messages(
  id, commitment_id, opportunity_id, channel, body,
  prompt_context TEXT, sent_at, created_at
)
```

### 3.2 Invariants
- A follow-up on the Follow-ups page = `commitments WHERE owner='me' AND status IN ('open','snoozed')`.
- `opportunities.priority_score` is **always** written together with `priority_reasons` —
  a score without a human-readable reason is a bug. The UI renders the reason, never the raw number alone.
- Insights are recomputed, never hand-edited; `dismissed_at` is the only user-writable column.
- `interactions` is the single source of truth for the Customer 360 timeline. Meetings are
  interactions with `type='meeting'` and a transcript — not a separate table.

### 3.3 Priority scoring (`lib/priority.ts` — replaces `lib/scoring.ts`)

Deterministic, transparent, testable. AI contributes *signals*; arithmetic contributes the score.

| Component | Weight | Source |
|---|---|---|
| Deal value (log-scaled vs. pipeline median) | 20 | `opportunities.value` |
| Follow-up overdue (days past due, capped) | 20 | `commitments.due_date` |
| Buying signals in last 14d | 15 | `signals` |
| Days since last interaction vs. stage norm | 15 | `interactions` |
| Stage × probability | 10 | `opportunities` |
| Unanswered customer questions | 10 | `signals kind='question'` |
| Risk signals (competitor, silence, price stall) | 10 | `signals` |
| **Total** | **100** | |

Bands: `critical ≥ 80`, `high 60–79`, `medium 35–59`, `low < 35`.
Every component that contributes ≥ 5 points emits a reason string. The score chip's tooltip
lists them verbatim. Rule: **no unexplained ranking anywhere in the product.**

---

## 4. Design system

Defined once in `app/globals.css` (Tailwind v4 `@theme`) — no per-component hex values.

```
Surface   canvas    #FAFAF9  (warm off-white — kills the "empty black canvas")
          card      #FFFFFF
          sunken    #F5F5F4
          border    #E7E5E4 / hairline #EFEDEB
Text      primary   #1C1917  secondary #57534E  muted #A8A29E
Brand     indigo    #4F46E5  (actions, active nav)  tint #EEF2FF
AI accent violet    #7C3AED  (AI-authored content ONLY — insight, draft, recommendation)
Semantic  positive  #059669  attention #D97706  risk #DC2626
```

- **AI-authored content is always violet-tinted with a ✦ mark.** The rep must be able to tell
  at a glance what the machine said vs. what a human recorded. This is a trust feature.
- **Type:** Geist (already installed). `Display 28/600 · H1 20/600 · H2 16/600 · Body 14/400 ·
  Meta 13/400 · Label 11/500 uppercase tracking-wide`. Numerals tabular in metrics.
- **Radius** 8px cards / 6px controls. **Shadow** one level only (`0 1px 2px rgba(0,0,0,.05)`);
  hierarchy comes from borders and spacing, not glow.
- **Spacing** 4px base. Page gutter 32px. Card padding 20px. Section gap 32px.
- **Density:** desktop-first. Rows ~56px. Content `max-w-[1200px]`.
- **Light mode only at launch.** The current auto-dark-mode media query is removed — a
  half-designed dark theme is worse than none. Dark mode is Phase 12.
- **Motion:** 120ms hover, 180ms enter, 240ms drawer. `prefers-reduced-motion` respected.
  Nothing loops, nothing bounces.

---

## 5. Implementation phases

Each phase ends in a demoable state. Ship in order; do not start a phase before the previous one runs.

---

### Phase 1 — Foundation: data model + design tokens ✅
**Goal:** the schema and visual language everything else is built on.

1. Rewrite `lib/db.ts` with the nine tables above; keep the additive-migration pattern
   (`PRAGMA table_info` guards) so an existing `data/followup.db` survives.
2. `lib/types.ts` — one shared TS type per entity, exported for both server and client.
3. `lib/repo/*.ts` — a thin repository per entity (`customers.ts`, `opportunities.ts`,
   `commitments.ts`, `interactions.ts`, `insights.ts`). **Routes never touch SQL directly.**
   This is the seam that lets us swap SQLite for Postgres/an API later without touching UI.
4. `app/globals.css` — full token set, delete the `prefers-color-scheme` block, drop the
   `font-family: Arial` override so Geist actually applies.
5. `lib/priority.ts` — the weighted model + reason strings, pure and unit-testable.

**Done when:** `npm run build` passes, tokens render, priority function has fixture tests.

---

### Phase 2 — Demo data ✅
Deliberately before the UI, so no screen is ever designed against emptiness.

- `lib/seed/demo.ts` + `npm run seed`. Deterministic (fixed seed), dates relative to *today*
  so the demo never goes stale.
- Volume: **15 customers · 24 contacts · 12 opportunities ($4K–$85K) · 30 commitments
  (7 overdue, 9 due today, 6 customer-owed) · 10 meetings with transcripts ·
  60 interactions across channels · 40 signals · 9 insights.**
- Composition is scripted for narrative: 3 at-risk deals (one silent 11 days with a 4×-opened
  proposal), 4 hot with buying signals, 2 with unanswered questions, 2 with no next step,
  1 clean/healthy account so the UI isn't uniformly alarming.

**Done when:** every planned screen has enough rows to look alive.

---

### Phase 3 — App shell ✅
- `app/(app)/layout.tsx` — persistent sidebar (grouped: Work / Pipeline / Intelligence),
  collapsible to 64px icon rail, state in `localStorage`.
- Sidebar footer: avatar + name + workspace + Settings.
- Top bar: breadcrumb, `⌘K` Ask trigger, `+ New` split button, notifications.
- Live counts on nav items (Follow-ups today, Overdue) — fetched once at layout level.
- Responsive: < 1024px sidebar becomes an overlay drawer; < 768px cards stack, tables → cards.
- Delete `app/components/NavBar.tsx`, retire `/upload`.

---

### Phase 4 — Command Center (`/`) ✅
The screen that must sell the product in five seconds.

1. **Greeting** — "Good morning, Rahul" + "Here's what needs your attention today." +
   one-line AI framing: *"4 things are overdue and 2 deals went quiet this week."*
2. **Metric strip** — 5 cards: Today's Actions · Overdue · At Risk · Hot · Waiting on You.
   Each is a filter link, not decoration. Delta vs. yesterday underneath.
3. **✦ Your priorities** — the AI action feed, the page's center of gravity. Rich card:
   priority band rail (left, 3px, semantic color) · company + deal value · contact + role ·
   last interaction · **✦ AI insight** · **You promised** · **Due** · **Recommended action** ·
   actions `[Generate Follow-up] [Mark Done] [Snooze ▾]`.
   Priority chip hover → the reason list from `lib/priority.ts`.
4. **Right rail** — Today's schedule, Waiting on customer, Recently closed.
5. **Empty state** — never a blank page: "You're all caught up 🎉" + upcoming counts +
   `[View upcoming]`.
6. **Keyboard:** `J/K` move, `Enter` open, `D` done, `S` snooze, `E` email, `W` WhatsApp,
   `C` generate. Focus ring visible; a `?` overlay lists all shortcuts.

---

### Phase 5 — Follow-ups (`/followups`) ✅
- Tabs: All · Today · Overdue · Upcoming · Waiting · Completed (counts in tab labels).
- Filter bar: priority, owner, stage, deal value range, customer, type. Filters live in the
  URL so a view is shareable and back/forward works.
- Dense table with an expandable row revealing the AI reason + recommendation.
- Row actions: Complete · Snooze (1d/3d/1w/custom) · Reschedule · Generate message ·
  Open customer · Assign · Delete.
- Bulk select → complete / snooze / reassign.
- Optimistic updates + undo toast (5s) on every destructive action.

---

### Phase 6 — Customer 360 (`/customers/[id]`) ✅
- **Header:** name · company · role · email · phone · opportunity value · stage ·
  priority chip · health pill. Primary actions: Log interaction · Generate follow-up · Add meeting.
- **Overview tab:** ✦ AI account summary (rolling narrative) · Needs · Objections ·
  Buying signals · Open questions · Commitments (both directions) · Next action ·
  ✦ AI recommendation.
- **Timeline tab:** chronological, channel-icon-coded, expandable events, filter by type.
- **Intel tab:** extracted facts KV, contacts/org map, competitors, budget, timeline.
- **Commitments tab:** scoped view of the Commitments page.
- `/customers` list gets: health, value, last touch, next action, priority — sortable, searchable.

---

### Phase 7 — Meeting Intelligence (`/meetings`) ✅
The wedge. Highest polish budget.

1. `/meetings/new` — customer picker (create-on-type), date, type, participants, notes,
   transcript paste (or `.txt`/`.vtt` drop), optional recording link.
2. On submit → streaming extraction UI showing each field as it lands (summary → pain points →
   requirements → objections → questions → buying signals → decision makers → budget →
   timeline → competitors → commitments (both sides) → next steps → follow-up date).
3. **The payoff screen:** *"✦ 3 actions detected"* — each as an editable proposed commitment
   with owner, due date, and channel pre-filled. `[Create all actions]` / edit / dismiss individually.
4. Extraction writes: `interactions`, `signals`, `commitments`, updates `customers.facts` +
   `ai_summary`, re-scores the opportunity.
5. Extend `lib/ai.ts` `extractMeeting` to the full schema; mock mode must return a rich,
   realistic payload so the flow demos with no API key.
6. `/meetings/[id]` — transcript alongside extraction, with re-extract.

---

### Phase 8 — Commitments · Opportunities · AI Insights · Generator ✅

**8a. Commitments (`/commitments`)** — tabs You owe / Customer owes / Completed. Grouped by
due date (Overdue, Today, Tomorrow, This week, Later). Customer-owed items get a
`[Nudge]` action that opens the generator pre-loaded with a chase message.

**8b. Opportunities (`/opportunities`)** — kanban across 8 stages, drag to move (writes stage +
probability, logs an interaction). Card: company · contact · value · probability · last
interaction · next action · ✦ health dot · days inactive. Column headers show count + total
value. List view toggle. Detail opens as a drawer.

**8c. AI Insights (`/insights`)** — sections: Hot leads · Deals at risk · Going cold ·
Buying signals · Unanswered questions · Missed follow-ups · No next step · Waiting on us.
Each row states **why** and **what to do**, with a one-click action. `lib/insights.ts`
computes all categories in one pass over cached data — **no AI call on page load**
(same discipline as today's `/api/digest`).

**8d. ✦ Follow-up Generator (drawer, global)** — opens from any card.
- Top: *Context used by AI* — collapsible chips (last meeting, concerns, previous messages,
  opportunity, next action). Transparency = trust.
- Channel tabs: Email · WhatsApp · LinkedIn · Call script.
- Streaming draft into an editable textarea.
- Actions: Copy · Edit · Regenerate · Make shorter · More casual · More persuasive ·
  Mark as sent (logs an interaction + completes the commitment).
- Reuses `generateMessage` / `refineMessage`; adds context assembly in `lib/context.ts`.

---

### Phase 9 — ⌘K Ask / AI assistant ✅
- Command palette: navigation, entity search, and natural-language ask in one surface.
- Intent router (`lib/ask.ts`) classifies the question into a handler:
  `who_today · going_cold · what_did_they_say · what_did_i_promise · waiting_on_me ·
   filter_query · meeting_prep · draft_message`, falling back to freeform.
- **Answers are actionable, not chat**: renders result *cards* with buttons
  (Generate follow-up, Open customer, Mark done). "Prepare me for my meeting with Acme
  tomorrow" returns a briefing card, not a paragraph.
- Recent + suggested questions on open. Reuses `answerQuestion` for the fallback path.
- Inbox screen ships here as an honest connect-a-channel state.

---

### Phase 10 — Analytics · Settings · Onboarding ◑ (onboarding deferred)
- Analytics: follow-up compliance, response rates by channel, stage conversion, avg days to
  close, commitments kept %, pipeline by band. (Only real charts — no vanity tiles.)
- Settings: profile, workspace/team, integrations, notification cadence, scoring weights
  (advanced), AI tone preferences.
- `/onboarding`: 5 steps — CRM · Email · Calendar · Meeting platform · Import customers →
  *"We found 27 customers that may need follow-up"* with detected actions and
  `[Create all]`. Every connector is a mock service behind `lib/integrations/*.ts` with the
  real interface shape, so a live provider drops in without UI changes.

---

### Phase 11 — Polish & hardening ✅
- Microinteractions: card hover lift, ✦ shimmer during generation, checkmark on complete,
  row slide-out on snooze, toasts with undo, sidebar transition. Nothing over 240ms.
- Loading: skeletons matching final layout (no spinners on primary content).
- Errors: per-surface error boundaries + retry; AI failures degrade to a manual path, never a dead end.
- Accessibility: keyboard reachable end to end, visible focus, AA contrast, ARIA live regions
  for streaming AI output, `prefers-reduced-motion`.
- Responsive pass at 1440 / 1280 / 1024 / 768 / 390.
- Remove all dead v1 UI: `NavBar.tsx`, `/upload`, old digest markup.
- Perf: Server Components by default, `"use client"` only for interactive leaves.

---

## 6. Cross-cutting engineering rules

- **Read `node_modules/next/dist/docs/` before writing route/layout/data-fetching code.**
  This Next.js version has breaking changes vs. training data (note the existing
  `LayoutProps<"/">` typed-routes signature in `app/layout.tsx`).
- **Server Components fetch; Client Components interact.** No `useEffect` data fetching for
  initial page data.
- **All data access goes through `lib/repo/*`.** No `db.prepare` in a route handler or page.
- **All AI access goes through `lib/ai.ts`,** which keeps working in mock mode with no API
  key — mock payloads must stay rich enough to demo every screen.
- **Every AI output is labeled** (✦ + violet) and carries its context provenance.
- **No AI call on a list/dashboard page load.** Scores and insights are computed on write or
  on an explicit recompute, and read from cache — extending today's `/api/digest` rule.
- **URL holds view state** (tabs, filters, sort) so views are shareable and navigable.
- **Optimistic UI + undo** for complete / snooze / stage change.

## 7. Sequencing summary

| Phase | Deliverable | Gate |
|---|---|---|
| 1 | Schema, repos, tokens, priority engine | build passes, priority tests green |
| 2 | Demo data | every screen has content |
| 3 | Shell: sidebar, top bar, responsive | navigation works end to end |
| 4 | Command Center | opens to a ranked, explained action feed |
| 5 | Follow-ups | complete/snooze/filter all work |
| 6 | Customer 360 | timeline + AI summary from real data |
| 7 | Meeting Intelligence | transcript → auto-created commitments |
| 8 | Commitments, Pipeline, Insights, Generator | core loop closes |
| 9 | ⌘K Ask | actionable answers |
| 10 | Analytics, Settings, Onboarding | first-run story complete |
| 11 | Polish, a11y, responsive, cleanup | ship quality |

**Minimum credible demo = Phases 1–8.** That is the full loop: meeting in → prioritized,
explained action out → AI-drafted message → done → re-scored.


---

## 8. Build log — what actually happened

Recorded so the plan stays honest about where reality diverged from it.

### Decisions changed during implementation

1. **Schema v1 → v2 is a rebuild, not a migration.** `lib/db.ts` gates on
   `PRAGMA user_version`: below version 2 it drops and recreates. The v1
   database held demo rows only, so writing forward-migration code for
   `customers`+`meetings` into nine tables would have cost more than reseeding.
2. **The priority feed groups by account.** The first build produced one card
   per commitment, which rendered two consecutive "ABC Technologies" cards with
   the same AI insight repeated verbatim. A rep thinks *"ABC needs two things
   today"*, so `priorityFeed()` now returns `{ lead, also[] }` per account.
3. **Priority weights were recalibrated after seeing real output.** The first
   pass scored Brightpath Media — where the customer had literally asked for the
   contract that day — as `low`. Buying signals are now weighted by *strength*
   rather than count, due-today counts for more, and the bands moved to
   70/50/30. Ranked output was re-inspected after the change.
4. **Onboarding (`/onboarding`) was not built.** The five-step connect flow is
   theatre until a real connector exists — it would be five screens that do
   nothing. The connector interfaces live in `lib/integrations/index.ts` with
   the shapes a real provider needs, surfaced honestly in Settings as
   "Not connected". This is the one planned item deliberately left out.
5. **Inbox shipped as planned** — real inbound interactions with detected
   signals, plus an explicit "channels not connected" state, rather than a
   fake mailbox.

### Bugs found and fixed while building

- `/\bcall|ring|phone|dial\b/` — alternation binds looser than `\b`, so `ring`
  matched inside "**b**ring" and misfiled an escalation as a call. All eight
  keyword patterns in `lib/ai.ts` were regrouped.
- Two `insights.ts` queries passed their bind parameter to `prepare()` instead
  of `all()`, so date filters silently did nothing.
- The mock draft generator spliced an imperative commitment title into a noun
  slot ("I've attached *send implementation plan*"), pasted a third-person
  summary into a second-person email, and — worst — **fabricated an answer** to
  the customer's open question ("the short answer is yes"). It now converts the
  title to a noun phrase and leaves an explicit `[Answer here before sending.]`
  slot instead of inventing content.
- `lib/ask.ts` imported the database and was pulled into the client bundle by
  `AskPalette`. Client-safe types moved to `lib/ask-shared.ts`, and `lib/db.ts`
  now imports `server-only` so the same mistake fails loudly at build time.
- Four `setState`-in-effect violations (React 19 lint). Fixed at the source, not
  suppressed: the sidebar reads `localStorage` through `useSyncExternalStore`,
  the mobile drawer closes on link click rather than on a pathname effect, and
  the Ask palette is mounted/unmounted by its parent so its state resets
  naturally.

### Verification performed

- `npm run lint` clean; `npx tsc --noEmit` clean; `npm run build` succeeds (14 routes).
- All 18 routes return 200, including every tab permutation.
- Core loop exercised directly against the repositories: completing the top
  action dropped its opportunity score 79 → 64 and updated the headline counts;
  stage moves rewrote probability and re-scored; a new interaction refreshed
  `last_interaction_at`.
- Extraction, drafting and refinement outputs were read and corrected, not just
  smoke-tested for a non-empty string.
- No horizontal overflow at 500 / 768 / 1024 / 1440px (`scrollWidth == viewport`).

### Known gaps

- `notFound()` returns HTTP 200 in the dev server while rendering the correct
  not-found UI. Cosmetic; worth confirming against `next start`.
- No automated test suite. `lib/priority.ts` is pure and the obvious first
  candidate for one.
- AI runs in mock mode until `GEMINI_API_KEY` is set in `.env.local`; the same
  code paths switch to Gemini 2.5 Flash with no other change.
