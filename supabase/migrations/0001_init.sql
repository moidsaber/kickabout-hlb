-- Kickabout schema. All access goes through the Next.js server using the
-- Postgres connection string, so RLS is enabled with NO policies: Supabase's
-- public REST API (anon key) can't read or write anything.

create extension if not exists pgcrypto;

create table players (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  phone         text,
  token         text not null unique,          -- remembered in the browser's localStorage
  weekly        jsonb not null default '[]',   -- [{day:'mon',start:'18:00',end:'22:00'}]
  skill         int check (skill between 1 and 5),
  monzo_username text,                          -- remembered for organisers
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);
create unique index players_name_lower on players (lower(name));
create index players_phone on players (phone);

create table games (
  id                text primary key,           -- short public id used in links
  title             text not null,
  location          text,
  maps_url          text,
  cost_pence        int  not null check (cost_pence >= 0),
  cap               int  not null default 14 check (cap > 0),
  admin_key         text not null,
  monzo_username    text,
  dropout_hours     int  not null default 24,
  status            text not null default 'open' check (status in ('open','confirmed','cancelled')),
  confirmed_slot_id uuid,
  kit               jsonb not null default '{}', -- {"ball": signupId, "bibs": signupId}
  created_by        uuid references players(id) on delete set null,
  created_at        timestamptz not null default now()
);

create table slots (
  id        uuid primary key default gen_random_uuid(),
  game_id   text not null references games(id) on delete cascade,
  starts_at timestamptz not null,
  unique (game_id, starts_at)
);
alter table games add constraint games_confirmed_slot_fk
  foreign key (confirmed_slot_id) references slots(id) on delete set null;

-- One row per person taking part in a game: a player, or a guest added by a player.
create table signups (
  id               uuid primary key default gen_random_uuid(),
  game_id          text not null references games(id) on delete cascade,
  player_id        uuid references players(id) on delete cascade,  -- null for guests
  guest_name       text,
  added_by         uuid references players(id) on delete set null, -- host of a guest (pays their share)
  skill            int check (skill between 1 and 5),               -- guest skill (players use players.skill)
  created_at       timestamptz not null default now(),              -- first response: order before confirmation
  queued_at        timestamptz,     -- position in the lineup queue once confirmed (null = not in queue)
  dropped_at       timestamptz,
  dropped_while_in boolean not null default false,
  check ((player_id is not null) <> (guest_name is not null))
);
create unique index signups_one_per_player on signups (game_id, player_id) where player_id is not null;
create index signups_game on signups (game_id);

create table availability (
  game_id    text not null references games(id) on delete cascade,
  slot_id    uuid not null references slots(id) on delete cascade,
  player_id  uuid not null references players(id) on delete cascade,
  available  boolean not null,
  updated_at timestamptz not null default now(),
  primary key (slot_id, player_id)
);
create index availability_game on availability (game_id);

create table payments (
  id           uuid primary key default gen_random_uuid(),
  game_id      text not null references games(id) on delete cascade,
  player_id    uuid not null references players(id) on delete cascade,
  amount_pence int  not null,
  created_at   timestamptz not null default now()
);
create index payments_player on payments (player_id);

create table events (
  id         bigserial primary key,
  game_id    text not null references games(id) on delete cascade,
  kind       text not null,          -- confirmed | dropped | promoted | joined | guest
  message    text not null,
  created_at timestamptz not null default now()
);
create index events_game on events (game_id, created_at desc);

-- Rate limiting for the natural-language parser.
create table ai_requests (
  id         bigserial primary key,
  key        text not null,
  created_at timestamptz not null default now()
);
create index ai_requests_key on ai_requests (key, created_at);

alter table players      enable row level security;
alter table games        enable row level security;
alter table slots        enable row level security;
alter table signups      enable row level security;
alter table availability enable row level security;
alter table payments     enable row level security;
alter table events       enable row level security;
alter table ai_requests  enable row level security;
