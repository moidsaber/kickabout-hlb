# ⚽ Kickabout

Organise casual 7-a-side games for a loose group of friends: pick a time, fill the pitch (with a waitlist), split the cost, and chase payments via Monzo, all from links people open from WhatsApp.

**Stack:** Next.js 16 (App Router) + TypeScript + Tailwind · Supabase Postgres · Claude API (`claude-haiku-5-5`) for natural-language availability · Vercel.

## How it works

1. **Organiser creates a game** on `/`: title, location + Google Maps link, pitch cost, cap (default 14) and 2–6 candidate kick-off times. The form suggests the 3 best times from recent players' stored weekly availability.
2. They get a **share link** (`/g/<id>`) and a **secret organiser link** (`/g/<id>/admin?key=…`), plus a ready-to-paste WhatsApp message.
3. **Players** enter their name (+ optional phone), remembered in the browser via a localStorage token. They tick slots, or type something like *"after 6 mon-fri, all day saturday, not sunday"*. Claude turns that into ticks (low-confidence guesses get a dashed outline), and the player confirms before anything is saved. Their usual week is stored and pre-fills future games.
4. **Organiser** sees per-slot counts and a player × slot grid, with the most popular slot highlighted, then confirms a time.
5. Once confirmed, the first 14 available (in order of response) are **in**; the rest go on an ordered **waitlist**. If someone drops, the top of the waitlist moves up automatically and the page shows "⬆️ Sam bumped up from the waitlist".
6. **Guests:** anyone can add "Moid's mate Sam". Guests count toward the cap and the split, and the host pays their share.
7. **Payments:** per head = pitch ÷ confirmed players (incl. guests), rounded **up** to 10p. Each player gets a one-tap `monzo.me/<user>/<amount>` link. The organiser ticks off who's paid, and unpaid amounts carry over to the next game (see `/balances`).
   - **Late dropouts:** drop within *X* hours of kick-off (default 24, configurable per game) and if nobody takes your spot you still owe your share.
8. **Extras:** WhatsApp copy buttons (sign-up, lineup, payment reminder), balanced/random team picker (1–5 skill set by the organiser), ball/bibs duties.

## Setup

### 1. Supabase
1. Create a project at [supabase.com](https://supabase.com) (region: London `eu-west-2`).
2. Run the schema: **SQL Editor → New query →** paste `supabase/migrations/0001_init.sql` → Run.
   (Or with the Supabase CLI: `supabase link && supabase db push`. Or: `DATABASE_URL=… npm run db:migrate`.)
3. Get the connection string: **Connect → Transaction pooler** (port `6543`), and put your DB password in it.

> The app talks to Postgres directly from server code using `DATABASE_URL`, so **you don't need the Supabase URL / anon key / service-role key**. Row-level security is enabled on every table with no policies, so Supabase's public REST API exposes nothing.

### 2. Environment variables

| Variable | Required | What |
|---|---|---|
| `DATABASE_URL` | ✅ | Supabase **transaction pooler** connection string |
| `ANTHROPIC_API_KEY` | ✅* | Claude API key, used only in `/api/v1/parse` (server-side). *Without it the app works and the text box falls back to manual ticking. |
| `ANTHROPIC_MODEL` | | Override the parser model (default `claude-haiku-5-5`) |
| `NEXT_PUBLIC_SITE_URL` | | Public URL used in links returned by the API (defaults to the request origin) |
| `BOT_API_KEY` | | For the phase-2 WhatsApp bot (see below) |

Copy `.env.example` to `.env.local` for local dev.

### 3. Run locally
```bash
npm install
cp .env.example .env.local   # fill in DATABASE_URL (+ ANTHROPIC_API_KEY)
npm run seed                 # demo data: 16 players, an open game, a past game with unpaid shares
npm run dev
```
The seed prints the links. Open `/g/demo-next` and enter a name: a new one (e.g. "Alex") or a seeded one (e.g. "Hannah"). The organiser page is `/g/demo-next/admin?key=demo-admin-key`. To see ticks pre-filled from a stored usual week, create a new game on `/` and open it as "Priya". The seed is safe to re-run and only touches its own rows.

### 4. Tests
```bash
npm test                                   # logic + parser prompt/normalisation tests
ANTHROPIC_API_KEY=sk-ant-… npm test        # also runs live parser tests ("evenings", "this weekend", "not tuesday", …)
```

### 5. Deploy to Vercel
1. Push this folder to a GitHub repo and **Import** it at [vercel.com/new](https://vercel.com/new) (framework: Next.js, defaults are fine).
2. Add `DATABASE_URL` and `ANTHROPIC_API_KEY` (and optionally `NEXT_PUBLIC_SITE_URL`) under **Settings → Environment Variables**.
3. Deploy. To get demo data in production: `DATABASE_URL=<prod url> npm run seed`.

CLI alternative: `npx vercel link && npx vercel env add DATABASE_URL && npx vercel env add ANTHROPIC_API_KEY && npx vercel --prod`.

## Code map

```
supabase/migrations/0001_init.sql   schema (players, games, slots, signups, availability, payments, events, ai_requests)
src/lib/logic.ts        pure rules: lineup/waitlist, cost split, late-dropout rule, weekly matching, suggestions, teams
src/lib/time.ts         Europe/London helpers (BST/GMT-safe)
src/lib/parse-core.ts   Claude prompt + zod schema (no server deps; reusable by a bot)
src/lib/parse.ts        Claude call (messages.parse + zodOutputFormat), server-only
src/lib/service.ts      DB operations; every route and a future bot go through these
src/lib/whatsapp.ts     ready-to-paste message text
src/app/api/v1/**       JSON API
src/components/**       mobile-first client UI
scripts/seed.ts         demo data
tests/**                vitest
```

### Data model (short)
- **players**: name (unique, case-insensitive), optional phone, browser token, `weekly` usual availability (`[{day,start,end}]`), skill 1–5, Monzo username.
- **games**: cost, cap, `admin_key`, Monzo username, `dropout_hours`, status (`open` | `confirmed` | `cancelled`), confirmed slot, kit duties.
- **slots**: candidate kick-off times (timestamptz). **availability**: player × slot yes/no.
- **signups**: one per player (or guest, with `added_by` = host) per game. `created_at` orders responses; `queued_at` is the frozen queue position after confirmation; `dropped_at` / `dropped_while_in` drive promotion and the late-dropout rule.
- **payments**: amounts paid per player per game. Charges are *computed* from the lineup, so balances = Σ charges − Σ payments across confirmed games.
- **events**: activity feed ("bumped up from the waitlist", "dropped out", …). **ai_requests**: parser rate limiting (10/player/hour).

## JSON API (for the phase-2 WhatsApp bot)

Auth: players send `x-player-token`; organiser endpoints take `x-admin-key` (or `?key=`). A bot can set `BOT_API_KEY` and send `x-bot-key` + `x-player-phone` to act on behalf of a player matched by phone.

| Method & path | Body | Notes |
|---|---|---|
| `POST /api/v1/players` | `{name, phone?}` | Identify/create, returns `{player, token}` |
| `GET/PATCH /api/v1/players/me` | `{weekly}` | Usual week |
| `GET /api/v1/games?upcoming=1` | | For `!games` |
| `POST /api/v1/games` | `{title, location?, mapsUrl?, costPence, cap?, slots: ISO[], monzoUsername?, dropoutHours?}` | For `!newgame`. Returns `url` + `adminUrl` |
| `GET /api/v1/games/:id` | | Full state: slots + counts, lineup, waitlist, money, events |
| `PATCH /api/v1/games/:id` | settings / `status` | admin |
| `POST /api/v1/games/:id/availability` | `{available: slotId[], weekly?}` | |
| `POST /api/v1/parse` | `{gameId, text}` | NL → `{slots, weekly, notes}`; never saves by itself |
| `POST /api/v1/games/:id/guests` | `{name}` | |
| `POST /api/v1/games/:id/drop` | `{signupId, rejoin?}` | self/own guests, or admin |
| `POST /api/v1/games/:id/confirm` | `{slotId}` | admin |
| `POST /api/v1/games/:id/paid` | `{playerId, paid}` | admin |
| `POST /api/v1/games/:id/skill` | `{signupId, skill}` | admin |
| `POST /api/v1/games/:id/kit` | `{duty: "ball"\|"bibs", signupId\|null}` | |
| `GET /api/v1/balances` | | For `!owe` |
| `GET /api/v1/suggestions` | | Top 3 kick-off times |

Phase 2 sketch: a small Node process (Baileys / whatsapp-web.js) maps `!newgame` → `POST /games`, `!games` → `GET /games?upcoming=1`, `!owe` → `GET /balances`, forwards free-text messages to `/parse` and then `/availability` (with `x-bot-key` + the sender's phone), and polls `GET /games?upcoming=1` to post reminders 24h/3h before `kickoff` plus payment reminders using `src/lib/whatsapp.ts`.

## Choices & limitations
- **No accounts, by design.** Entering an existing name on a new phone "logs you in" as that player, which suits a friends group but isn't secure. The organiser's power lives only in the secret admin link.
- **Guests play when their host is available** (they're "coming with" the host).
- **Queue order is frozen at confirmation.** Anyone who becomes available afterwards joins the back of the queue, so they can't bump people who are already in.
- Ticking "paid" records payment for this game **plus** earlier unpaid games owed to the same Monzo username. If the price per head later drops, the difference shows as credit.
- Pages poll every 30s rather than using realtime subscriptions.
