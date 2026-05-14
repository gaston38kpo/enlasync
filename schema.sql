-- EnlaSync database schema

create table if not exists public.bookmark_syncs (
  sync_key   text        primary key,
  tree       jsonb       not null,
  updated_by text        not null,
  updated_at timestamptz not null default now()
);

-- Auto-update updated_at on every upsert
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create or replace trigger bookmark_syncs_updated_at
  before insert or update on public.bookmark_syncs
  for each row execute function public.set_updated_at();

-- Enable Realtime for this table
alter publication supabase_realtime add table public.bookmark_syncs;

-- Row Level Security
alter table public.bookmark_syncs enable row level security;

create policy "anon can read and write own sync key"
  on public.bookmark_syncs
  for all
  to anon
  using (true)
  with check (true);
