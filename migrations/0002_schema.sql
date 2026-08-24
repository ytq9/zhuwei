-- 烛帷 tabletop rooms, characters, messages, and GM state
create table if not exists rooms (
  id           text primary key,
  code         text not null unique,
  host_user_id text not null,
  title        text not null default '黑橡居酒屋的第三份遗嘱',
  module_id    text not null default 'black-oak-will',
  status       text not null default 'lobby',
  created_at   timestamptz not null default now()
);
create index if not exists rooms_host_idx on rooms (host_user_id);

create table if not exists room_members (
  room_id   text not null references rooms(id) on delete cascade,
  user_id   text not null,
  nickname  text not null default '',
  is_host   boolean not null default false,
  seated    boolean not null default true,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index if not exists room_members_user_idx on room_members (user_id);

create table if not exists characters (
  id         text primary key,
  room_id    text not null references rooms(id) on delete cascade,
  user_id    text not null,
  sheet      jsonb not null,
  locked     boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (room_id, user_id)
);

create table if not exists messages (
  id         text primary key,
  room_id    text not null references rooms(id) on delete cascade,
  user_id    text,
  kind       text not null,
  name       text not null default '',
  body       text not null,
  tts_text   text,
  meta       jsonb,
  created_at timestamptz not null default now()
);
create index if not exists messages_room_idx on messages (room_id, created_at);

create table if not exists game_states (
  room_id         text primary key references rooms(id) on delete cascade,
  chapter_id      text not null default 'ch1',
  scene_id        text not null default 'wake',
  revealed_clues  jsonb not null default '[]',
  npc_flags       jsonb not null default '{}',
  combat          jsonb,
  pending_rolls   jsonb not null default '[]',
  kp_busy         boolean not null default false,
  secret          jsonb not null default '{}',
  updated_at      timestamptz not null default now()
);

create table if not exists session_logs (
  id         text primary key,
  room_id    text not null references rooms(id) on delete cascade,
  entry      text not null,
  created_at timestamptz not null default now()
);
create index if not exists session_logs_room_idx on session_logs (room_id, created_at);
