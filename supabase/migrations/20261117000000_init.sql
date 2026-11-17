-- Kanban Studio schema. The backend connects as a privileged role; the Supabase Data API
-- (anon/authenticated roles) gets no access at all.

create table public.users (
  id bigint generated always as identity primary key,
  username text not null,
  password_hash text not null,
  is_admin boolean not null default false,
  is_guest boolean not null default false,
  created_at timestamptz not null default now()
);
-- Usernames are unique ignoring case ("User" and "user" cannot both exist)
create unique index idx_users_username_lower on public.users (lower(username));
-- Daily guest cleanup
create index idx_users_guest_created on public.users (created_at) where is_guest;

create table public.boards (
  id bigint generated always as identity primary key,
  user_id bigint not null references public.users (id) on delete cascade,
  name text not null,
  board_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_boards_user on public.boards (user_id);

create table public.conversations (
  id bigint generated always as identity primary key,
  board_id bigint not null references public.boards (id) on delete cascade,
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_conversations_board on public.conversations (board_id);

create table public.chat_messages (
  id bigint generated always as identity primary key,
  conversation_id bigint not null references public.conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);
create index idx_messages_conversation on public.chat_messages (conversation_id, id);

-- One row per AI request. Tied to the user only, so deleting chats or boards does not
-- reset the daily limit.
create table public.ai_usage (
  id bigint generated always as identity primary key,
  user_id bigint not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index idx_ai_usage_user_time on public.ai_usage (user_id, created_at);

alter table public.users enable row level security;
alter table public.boards enable row level security;
alter table public.conversations enable row level security;
alter table public.chat_messages enable row level security;
alter table public.ai_usage enable row level security;
revoke all on all tables in schema public from anon, authenticated;
