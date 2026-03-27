create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.gmail_connections (
  session_id text primary key,
  email text not null,
  google_user_id text,
  access_token text,
  refresh_token text not null,
  scope text,
  token_type text,
  access_token_expires_at timestamptz,
  display_name text,
  picture_url text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.gmail_oauth_states (
  state text primary key,
  session_id text not null,
  redirect_to text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists gmail_oauth_states_session_idx on public.gmail_oauth_states (session_id);
create index if not exists gmail_oauth_states_expires_idx on public.gmail_oauth_states (expires_at);

drop trigger if exists gmail_connections_set_updated_at on public.gmail_connections;
create trigger gmail_connections_set_updated_at
before update on public.gmail_connections
for each row
execute function public.set_updated_at();

alter table public.gmail_connections enable row level security;
alter table public.gmail_oauth_states enable row level security;
