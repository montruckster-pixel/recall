# Recall

**Study smarter. Remember longer. Walk into your exam prepared.**

Recall is a full-stack certification study platform. Upload your study materials, turn them into
personalized flashcards and practice exams, and study with real spaced repetition (FSRS) — with a
study plan and progress analytics that adapt to what you actually do.

This repository is a **complete, runnable application**: real authentication, a real relational
database, real server-side AI generation, real spaced-repetition scheduling, and a real
subscription layer that only grants premium access from verified Stripe events.

---

## Table of contents

- [What is implemented](#what-is-implemented)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [AI setup](#ai-setup)
- [Billing setup (Stripe)](#billing-setup-stripe)
- [Architecture](#architecture)
- [Data model](#data-model)
- [How the spaced repetition works](#how-the-spaced-repetition-works)
- [Testing](#testing)
- [Deployment](#deployment)
- [Security notes](#security-notes)
- [Moving to PostgreSQL](#moving-to-postgresql)
- [Project layout](#project-layout)
- [Known limitations](#known-limitations)

---

## What is implemented

Everything below works end to end, verified by an automated API suite (49 checks) and a real
headless-browser suite (19 checks) that exercises the UI.

**Accounts & onboarding**
- Email + password sign-up and sign-in with scrypt password hashing
- Server-side sessions (opaque tokens, hashed at rest), httpOnly + SameSite cookies
- Password reset by email (SMTP-configurable, single-use expiring tokens, anti-abuse throttle), change password (invalidates other sessions)
- 4-step onboarding: name, certification, exam date + daily time, knowledge level, study methods,
  available days
- Data-driven certification catalog across IT & cybersecurity, healthcare, trades & technical,
  business & finance, and other — plus a custom option

**Study sets & flashcards**
- Full CRUD for study sets and cards, with search, subject/topic filters, sorting, favorites and
  archiving
- Bulk operations: move, retag, set difficulty, delete
- Duplicate a set, add cards one at a time or in bulk
- Manual flashcard creation works with **no AI configured at all**

**Material processing**
- Upload **PDF** (`pdftotext`), **DOCX** (mammoth), **PPTX** (unzip + XML), **TXT/MD/CSV/JSON/HTML**,
  or paste notes directly
- Extraction status tracking with a real error message and a retry action on failure
- Text preview, original-file download, and deletion
- AI generation produces a **reviewable draft** (summary, topics, key terms, flashcards, MCQs,
  short answers, suggested sessions). You edit it and explicitly save it — nothing is written to
  your library behind your back

**Spaced repetition**
- FSRS-4.5 scheduler (the 17-parameter model used by Anki's built-in FSRS) plus Anki-style
  learning/relearning steps
- Four-point rating (Again / Hard / Good / Easy) with live next-interval previews
- Due Today queue, per-card stability and difficulty, lapse tracking, "leech" list
- Immersive study mode with card flip, keyboard shortcuts, shuffle, progress and a session summary
- Reviewing cards costs **zero AI credits**

**Practice exams**
- Build quizzes from a study set (AI-generated, or a grounded non-AI fallback that uses other cards
  as distractors) or from an uploaded document
- Multiple choice, true/false and short answer
- Practice and timed exam modes with a live countdown, incremental answer saving and resume
- Scoring, explanations, common misconceptions, per-topic breakdown, improvement tracking
- Retry missed questions, or convert missed questions into flashcards

**Planning & analytics**
- Adaptive 14-day study plan generated from due counts, weak topics, exam proximity, time budget
  and available weekdays; missed days are re-planned rather than breaking the schedule
- Manual session creation, completion, rescheduling and deletion
- Dashboard: daily goals, streak, continue-studying, exam countdown with an explainable readiness
  estimate, areas to improve, recent activity
- Analytics: study minutes, cards reviewed, quiz scores over time, review accuracy, consistency
  heatmap, backlog, rule-based insights
- Plus: topic-level breakdown, frequently missed concepts, and AI-generated coaching insights

**Subscription & billing**
- Free and Recall Plus plans with **server-enforced** limits (workspaces, sets, flashcards,
  monthly AI credits, monthly practice exams, advanced analytics)
- Two Stripe modes: **Payment Links** (quickest) and **Checkout Sessions** with price IDs
- Signature-verified, idempotent webhook handling
- Success-redirect confirmation that re-fetches the session from Stripe with the secret key
- Cancel at period end, resume, and Stripe-hosted billing portal
- Clear in-app setup guidance when Stripe is not yet configured

**Product quality**
- Responsive down to 390px, with a collapsible mobile sidebar
- Dark / light / system theme, reduced-motion support
- Empty, loading, error and disabled states throughout
- Accessibility: skip link, focus-visible outlines, ARIA labels, `aria-current`, keyboard-operable
  flashcards and dialogs
- Plain-language Privacy and Terms pages, full JSON data export, and self-service account deletion
- Honest labelling: practice questions are explicitly marked as generated practice material, and
  readiness is described as an estimate

---

## Quick start

Requirements: **Node.js 22.5+** (for the built-in `node:sqlite`), and optionally `poppler-utils`
for PDF extraction and `unzip` for PPTX.

```bash
npm install
cp .env.example .env      # optional — the app runs without it
npm run seed              # optional: creates a demo account
npm start
```

Open <http://localhost:3000>.

The demo account created by `npm run seed` is:

```
demo@recall.local / demo12345
```

> The server never seeds data on its own — `scripts/seed-demo.js` is the only thing that creates
> the demo account.

The app is fully usable with **no** configuration: manual flashcards, spaced repetition and the
free plan all work. AI generation and paid upgrades are the only features that need keys.

---

## Configuration

Every setting is optional and read from the environment (see `.env.example` for the full list).

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (default `3000`) |
| `APP_BASE_URL` | Public base URL used for Stripe redirects and reset links |
| `RECALL_DB_PATH` | SQLite file (default `./data/recall.db`) |
| `RECALL_UPLOAD_DIR` | Private upload directory (default `./data/uploads`) |
| `RECALL_MAX_UPLOAD_BYTES` | Upload size cap (default 15 MB) |
| `RECALL_SECURE_COOKIES` | Set to `1` behind HTTPS |
| `AI_PROVIDER` | `gemini` (default), `openai`, `anthropic`, or `none` |
| `AI_MODEL` | Model name for the chosen provider |
| `GEMINI_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | Provider credentials |
| `GEMINI_BASE_URL` / `GENAI_PROXY_TOKEN` / `AI_USER_AGENT` | Optional gateway configuration |
| `STRIPE_*` | See [Billing setup](#billing-setup-stripe) |
| `RECALL_MAIL_TRANSPORT` | `auto` (default), `smtp`, `file`, `console`, or `none` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | SMTP provider connection |
| `SMTP_USER` / `SMTP_PASS` | SMTP credentials (omit for unauthenticated relays) |
| `MAIL_FROM` / `MAIL_FROM_NAME` | From address and display name on outgoing mail |
| `RECALL_MAIL_OUTBOX_DIR` | Where the `file` transport writes messages |
| `RECALL_RESET_TOKEN_MINUTES` | Password-reset link lifetime (default 60) |
| `RECALL_RESET_COOLDOWN_MS` | Minimum gap between reset emails per address (default 60000) |
| `RECALL_ALLOW_DEV_UPGRADE` | Enables a dev-only plan toggle. **Never enable in production.** |

---

## AI setup

AI powers document processing, question generation and short-answer grading. Set one provider:

**Google Gemini (default)**

```env
AI_PROVIDER=gemini
AI_MODEL=gemini-2.5-flash
GEMINI_API_KEY=your-key
```

**OpenAI**

```env
AI_PROVIDER=openai
AI_MODEL=gpt-4o-mini
OPENAI_API_KEY=sk-...
```

**Anthropic**

```env
AI_PROVIDER=anthropic
AI_MODEL=claude-3-5-sonnet-latest
ANTHROPIC_API_KEY=sk-ant-...
```

**Behind an API gateway** (some deployments proxy model traffic), point at the gateway and supply
its token; Recall sends it as the `x-goog-api-key` header along with `AI_USER_AGENT`:

```env
GEMINI_BASE_URL=https://your-gateway.example/v1beta
GENAI_PROXY_TOKEN=your-gateway-token
AI_USER_AGENT=your-allowed-agent
```

If AI is not configured the UI says so explicitly and disables generation; everything else keeps
working.

---

## Email setup (password reset)

Password resets send a real email. Delivery is controlled by
`RECALL_MAIL_TRANSPORT`:

| Transport | What it does |
|---|---|
| `smtp` | Delivers through your provider using `nodemailer`. **The only transport that reaches an inbox.** |
| `file` | Writes each message to `RECALL_MAIL_OUTBOX_DIR` as `.json` + `.txt`. Ideal for local development and tests. |
| `console` | Prints the message to the server log. |
| `none` | Disables sending; the endpoint still returns its generic response. |
| `auto` | *(default)* `smtp` when `SMTP_HOST` is set, otherwise `file` when an outbox directory is configured, otherwise `console`. |

**Production setup** — any SMTP provider works (Postmark, SES, Resend, SendGrid,
Mailgun, Gmail, …):

```env
RECALL_MAIL_TRANSPORT=smtp
SMTP_HOST=smtp.postmarkapp.com
SMTP_PORT=587
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
MAIL_FROM="Recall <no-reply@yourdomain.com>"
APP_BASE_URL=https://your-domain.com
```

Port `465` uses implicit TLS; `587` uses STARTTLS. Set `SMTP_SECURE` explicitly
if your provider is unusual. `MAIL_FROM` falls back to `SMTP_USER`.

**Local development** — nothing to configure. With no SMTP host set, messages
are written to `./data/outbox`, and the API also returns the reset link so you
can complete the flow. `GET /api/auth/mail-status` reports the active transport,
and the reset page shows a warning banner whenever mail is not actually
delivered.

```env
RECALL_MAIL_TRANSPORT=file
RECALL_MAIL_OUTBOX_DIR=./data/outbox
```

Notes:

- `forgot-password` returns the **same response for every address**, so it cannot
  be used to discover which emails have accounts. Delivery failures are logged
  for operators and never surfaced to the caller.
- Reset links are throttled to one email per address per minute, and tokens are
  single-use and expire after `RECALL_RESET_TOKEN_MINUTES`.
- `RECALL_EXPOSE_RESET_TOKEN=1` forces the link into the API response. It exists
  for automated testing — leave it at `0` in production.

## Billing setup (Stripe)

Premium access is **only** granted server-side, and only from a verified Stripe event or a Checkout
Session re-fetched with your secret key. The browser can never grant itself a plan.

### Option A — Payment Links (fastest)

1. In Stripe, create two recurring Payment Links (monthly and annual) for the Plus price.
2. Set the webhook endpoint to `POST https://your-domain/api/billing/webhook` for
   `checkout.session.completed`, `customer.subscription.*`, and `invoice.*` events.
3. Configure:

```env
STRIPE_PAYMENT_LINK_MONTHLY=https://buy.stripe.com/...
STRIPE_PAYMENT_LINK_ANNUAL=https://buy.stripe.com/...
STRIPE_WEBHOOK_SECRET=whsec_...
APP_BASE_URL=https://your-domain
```

Recall appends `client_reference_id` (your account id) and `prefilled_email` to the link so a
completed purchase can be attributed to the right user.

### Option B — Checkout Sessions

```env
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PRICE_PLUS_MONTHLY=price_...
STRIPE_PRICE_PLUS_ANNUAL=price_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

Recall creates the Checkout Session server-side and returns Stripe's hosted URL.

### Local testing without Stripe

```env
RECALL_ALLOW_DEV_UPGRADE=1
```

This enables `POST /api/billing/dev-activate`, which flips the plan locally so paid features can be
exercised. It is disabled by default and returns `403` unless the flag is set. It is not a
substitute for a real payment and must stay off in production.

---

## Architecture

A single Node.js process serves both the JSON API and the static single-page frontend.

```
Browser (vanilla ES modules, no build step)
        │  fetch, cookie auth, same-origin
        ▼
Express  ── security headers, rate limiting, CSRF guard
        │
        ├── routes/auth.js       sign-up, sign-in, sessions, password reset
        ├── routes/profile.js    onboarding, preferences, export, deletion
        ├── routes/materials.js  upload, extraction, AI generation, commit
        ├── routes/sets.js       study sets and flashcards
        ├── routes/study.js      due queue, FSRS reviews, sessions, leeches
        ├── routes/quizzes.js    quiz builder, attempts, grading, results
        ├── routes/planner.js    adaptive plan and sessions
        ├── routes/analytics.js  aggregates, topic analysis, insights
        ├── routes/dashboard.js  single-round-trip dashboard payload
        └── routes/billing.js    plans, entitlements, Stripe, webhooks
        │
        ▼
lib/  db · auth · fsrs · ai · studygen · extract · billing · planner · activity · certifications
        │
        ▼
SQLite (node:sqlite) + private upload directory
```

**Why no frontend build step?** The SPA is written as native ES modules with a small hand-rolled
router, DOM helper and SVG chart library. There is no bundler, no transpiler and no framework
runtime to keep patched — `npm install` installs only the server's dependencies, and the browser
loads the same files you can read.

---

## Data model

All tables live in `server/lib/db.js`. Every user-owned row carries `user_id`, and every query in
the route layer is scoped to the authenticated user.

| Table | Purpose |
|---|---|
| `users`, `sessions`, `password_resets` | Accounts, sessions, reset tokens |
| `profiles`, `user_settings` | Study preferences and UI preferences |
| `certifications` | Data-driven certification catalog |
| `workspaces` | Certification workspaces |
| `materials` | Uploaded documents and extracted text |
| `generations` | Reviewable AI drafts before they are saved |
| `study_sets`, `flashcards` | Study content |
| `card_schedule` | Per-card FSRS state (stability, difficulty, due date) |
| `card_reviews` | Full review history |
| `quizzes`, `quiz_questions`, `quiz_attempts`, `attempt_answers` | Practice exams and results |
| `study_plan_days`, `study_tasks` | Planner |
| `daily_activity` | Daily counters for dashboards and analytics |
| `ai_usage` | Monthly AI credit metering |
| `subscriptions`, `billing_events` | Billing state and webhook idempotency |

---

## How the spaced repetition works

`server/lib/fsrs.js` implements **FSRS-4.5**:

```
R(t, S) = (1 + FACTOR · t/S) ^ DECAY                      retrievability
I(S)    = (S / FACTOR) · (R_desired^(1/DECAY) − 1)        interval for a target retention
D'      = D − w6·(g−3)  →  mean-reverted toward D0(4)     difficulty update
S'_recall = S · (1 + e^w8 · (11−D) · S^(−w9) · (e^(w10·(1−R)) − 1) · hard · easy)
S'_forget = w11 · D^(−w12) · ((S+1)^w13 − 1) · e^(w14·(1−R))
```

with `DECAY = −0.5`, `FACTOR = 19/81`, a target retention of 0.9, and Anki-style short-term
learning steps (`[1m, 10m]` for learning, `[10m]` for relearning). Cards you struggle with return
sooner; cards you know well are pushed further out. Ratings are 1 Again, 2 Hard, 3 Good, 4 Easy.

---

## Testing

```bash
npm run smoke     # 49 API checks against a temporary database
npm run seed      # create the demo account
```

`scripts/smoke-test.js` boots the server on a random port against a throwaway database and verifies
the full happy path plus key error cases: authentication, duplicate/weak credentials, password reset
with real email delivery (outbox contents, token single-use, old password rejection), onboarding,
set and card CRUD, validation, FSRS review scheduling and previews, quiz build/take/score/summary,
double-submit rejection, missed-question conversion, material upload and extraction, unsupported
file rejection, planner, analytics, entitlements, dev upgrade, cancel, unsigned-webhook rejection,
unauthenticated access, and data export.

The browser suite used during development drives a real headless Chromium through sign-up,
onboarding, a flashcard session, every authenticated route, the public pricing page and the mobile
sidebar, and asserts zero console errors. It requires Playwright, so it is not part of
`npm test` by default.

---

## Deployment

1. Provision a host with Node.js 22.5+ and a persistent volume for `data/`.
2. `npm ci --omit=dev`
3. Set environment variables (`NODE_ENV=production`, `RECALL_SECURE_COOKIES=1`, `APP_BASE_URL`).
4. Install `poppler-utils` if you want PDF extraction, and `unzip` for PPTX.
5. Run behind a TLS-terminating reverse proxy and point Stripe's webhook at
   `https://your-domain/api/billing/webhook`.
6. Back up the `data/` directory (the SQLite file plus uploads).

For a container or PaaS, the same steps apply — the process listens on `$PORT` and needs one
writable directory.

---

## Security notes

- Passwords are hashed with **scrypt** (`N=16384, r=8, p=1`, per-user salt, constant-time compare).
- Session tokens are random 32-byte values; only their SHA-256 hashes are stored. Cookies are
  `httpOnly`, `SameSite=Lax`, and `Secure` in production.
- A CSRF guard rejects state-changing requests carrying a cross-site `Sec-Fetch-Site` header.
- Strict security headers: CSP (no inline scripts, no external origins), `X-Frame-Options: DENY`,
  `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS in production.
- Rate limiting on auth endpoints (40 / 15 min) and the general API (240 / min).
- Uploads are size-capped, extension-validated, stored outside the web root, and served only
  through an authenticated, user-scoped endpoint.
- Every database query is parameterised. Every read and write is scoped by `user_id`.
- AI and Stripe keys live only in the server environment and are never sent to the browser.
- Plan limits and premium features are enforced on the server. `POST /api/billing/webhook`
  verifies the Stripe signature before trusting anything, and events are processed idempotently.
- Account deletion removes all study data and replaces the email with a tombstone.

---

## Moving to PostgreSQL

The schema is intentionally portable SQL. To switch:

1. Replace `server/lib/db.js` with a `pg` pool exposing the same `run` / `get` / `all` / `tx`
   helpers.
2. Convert the schema: `TEXT` → `TEXT`, `INTEGER` booleans → `BOOLEAN`, `REAL` → `DOUBLE PRECISION`,
   and add `TIMESTAMPTZ` for the ISO timestamp columns.
3. Replace SQLite-only syntax (`ON CONFLICT(slug) DO UPDATE`, `INSERT OR ...`) with the PostgreSQL
   equivalent and add a migrations tool.
4. Everything else — routes, schedulers, billing, AI — is storage-agnostic.

---

## Project layout

```
recall/
├── server/
│   ├── index.js                 Express app, security middleware, static SPA
│   ├── lib/
│   │   ├── db.js                Schema and query helpers (node:sqlite)
│   │   ├── auth.js              scrypt, sessions, CSRF, password reset
│   │   ├── fsrs.js              FSRS-4.5 spaced-repetition scheduler
│   │   ├── ai.js                Gemini / OpenAI / Anthropic + usage metering
│   │   ├── studygen.js          Prompting, JSON validation, normalization
│   │   ├── extract.js           PDF / DOCX / PPTX / text extraction
│   │   ├── mailer.js            SMTP / file / console email delivery + templates
│   │   ├── billing.js           Plans, entitlements, Stripe configuration
│   │   ├── planner.js           Adaptive study-plan generation
│   │   ├── activity.js          Daily counters, streaks, weak topics
│   │   ├── certifications.js    Certification catalog
│   │   └── util.js              Ids, errors, validation, pagination
│   └── routes/                  auth · profile · materials · sets · study ·
│                                quizzes · planner · analytics · dashboard · billing
├── public/
│   ├── index.html               App shell
│   ├── css/app.css              Design system
│   └── js/
│       ├── app.js               Bootstrap, shell, route table
│       ├── api.js  store.js  router.js  ui.js
│       └── views/               landing/pricing/legal · auth · onboarding ·
│                                dashboard · sets · study · materials · quiz ·
│                                planner · analytics · settings · billing
├── scripts/
│   ├── seed-demo.js             Demo account
│   └── smoke-test.js            37-check API suite
├── .env.example
└── README.md
```

---

## Known limitations

Stated plainly rather than hidden:

- **SQLite, not PostgreSQL.** Deliberate: it makes the app run with zero external services. The
  migration path is documented above.
- **Email needs an SMTP provider.** Delivery is fully implemented, but with no
  `SMTP_HOST` configured the default transport writes messages to a local outbox
  instead of sending them. Set the SMTP variables above before going live.
- **PDF extraction needs `pdftotext`.** Scanned/image-only PDFs need OCR before upload; the app
  says so instead of silently producing nothing.
- **AI output can be wrong.** Generated questions are grounded in your material and validated
  structurally, but they are practice material, not verified fact. Short-answer grading is an
  estimate and the UI says so.
- **Readiness score is an estimate**, computed transparently from your own coverage, backlog and
  recent quiz average. It is not a prediction of your exam result.
- **No background job queue.** Extraction and generation run in the request. A very large document
  means a slow request; a queue would be the next step at scale.
- **Certification catalog is a starting set**, not a complete index of every certification in
  existence. It is data-driven and easy to extend.
