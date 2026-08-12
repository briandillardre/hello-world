-- 062: Founding 25 reservations — the demand-proof funnel step.
-- Public /reserve page inserts here via the service role (no auth — these
-- are prospects, not users). Brian works the list by phone; deposit is
-- collected on the call (Stripe Payment Link) once billing is live.

create table if not exists reservations (
  id uuid primary key default gen_random_uuid(),
  company text not null,
  name text not null,
  phone text not null,
  email text,
  machines int not null default 0,
  tools int not null default 0,
  note text,
  status text not null default 'new', -- new | called | deposit | installed | passed
  created_at timestamptz not null default now()
);

alter table reservations enable row level security;
-- No public policies: service-role inserts/reads only. Admin UI comes later;
-- until then the list is read in Supabase or via the notify email.
