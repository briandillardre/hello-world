-- Rest Stop Royale: King of the Hill tables

create table if not exists koth_rest_areas (
  id text primary key,
  name text not null,
  lat double precision not null,
  lng double precision not null,
  state text not null,
  country text not null default 'US',
  highway text not null,
  direction text,
  amenities text[] default '{}',
  fun_fact text,
  avg_rating numeric(3,2) default 0,
  review_count int default 0,
  created_at timestamptz default now()
);

create table if not exists koth_scores (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  username text not null,
  game_id text not null check (game_id in ('trucker-tap', 'gas-guesser', 'bathroom-bingo')),
  rest_area_id text not null references koth_rest_areas(id),
  score int not null,
  created_at timestamptz default now()
);

create index koth_scores_rest_area_idx on koth_scores(rest_area_id, created_at desc);
create index koth_scores_user_idx on koth_scores(user_id, created_at desc);

create table if not exists koth_reviews (
  id uuid primary key default gen_random_uuid(),
  rest_area_id text not null references koth_rest_areas(id),
  user_id text not null,
  username text not null,
  overall_rating int not null check (overall_rating between 1 and 5),
  cleanliness_rating int not null check (cleanliness_rating between 1 and 5),
  vending_rating int not null check (vending_rating between 1 and 5),
  vibes_rating int not null check (vibes_rating between 1 and 5),
  review_text text not null,
  photo_emoji text,
  upvotes int default 0,
  created_at timestamptz default now()
);

create index koth_reviews_rest_area_idx on koth_reviews(rest_area_id, created_at desc);

create table if not exists koth_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  username text not null,
  rest_area_id text not null references koth_rest_areas(id),
  points_earned int default 50,
  created_at timestamptz default now()
);

-- View: current kings per rest area (rolling 30-day window)
create or replace view koth_kings as
select
  rest_area_id,
  user_id,
  username,
  sum(score) as total_score,
  min(created_at) as king_since
from koth_scores
where created_at > now() - interval '30 days'
group by rest_area_id, user_id, username
order by rest_area_id, total_score desc;

-- RLS: anyone can read, authenticated users can write their own
alter table koth_scores enable row level security;
alter table koth_reviews enable row level security;
alter table koth_checkins enable row level security;
alter table koth_rest_areas enable row level security;

create policy "koth_rest_areas_read" on koth_rest_areas for select using (true);
create policy "koth_scores_read" on koth_scores for select using (true);
create policy "koth_scores_insert" on koth_scores for insert with check (true);
create policy "koth_reviews_read" on koth_reviews for select using (true);
create policy "koth_reviews_insert" on koth_reviews for insert with check (true);
create policy "koth_checkins_insert" on koth_checkins for insert with check (true);
create policy "koth_checkins_read" on koth_checkins for select using (true);
