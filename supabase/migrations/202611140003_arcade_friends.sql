create table if not exists public.arcade_friendships (
  sender uuid not null references auth.users(id) on delete cascade,
  recipient uuid not null references auth.users(id) on delete cascade,
  accepted boolean not null default false,
  check (sender <> recipient)
);
create unique index if not exists arcade_friend_pair on public.arcade_friendships
  (least(sender, recipient), greatest(sender, recipient));
create index if not exists arcade_friend_sender on public.arcade_friendships(sender);
create index if not exists arcade_friend_recipient on public.arcade_friendships(recipient);
create table if not exists public.arcade_presence (
  user_id uuid primary key references auth.users(id) on delete cascade,
  game text not null check (game ~ '^[a-z0-9-]{1,80}$'),
  seen_at timestamptz not null
);
alter table public.arcade_friendships enable row level security;
alter table public.arcade_presence enable row level security;
revoke all on public.arcade_friendships, public.arcade_presence from public, anon, authenticated;

create or replace function public.arcade_friend_action(profile_name text, action text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  peer uuid;
begin
  if me is null or profile_name is null or profile_name !~ '^[a-z0-9_.-]{3,24}$' then
    raise exception 'Richiesta non valida.';
  end if;
  select u.id into peer from auth.users u
  left join public.arcade_profiles p on p.user_id = u.id
  where u.email ~ '^[a-z0-9_.-]{3,24}@arcade[.]invalid$'
    and coalesce(p.username, split_part(u.email, '@', 1)) = profile_name;
  if peer is null or peer = me then raise exception 'Profilo non disponibile.'; end if;

  case action
    when 'request' then
      insert into public.arcade_friendships (sender, recipient) values (me, peer) on conflict do nothing;
    when 'accept' then
      update public.arcade_friendships set accepted = true where sender = peer and recipient = me and not accepted;
    when 'decline' then
      delete from public.arcade_friendships where sender = peer and recipient = me and not accepted;
    when 'cancel' then
      delete from public.arcade_friendships where sender = me and recipient = peer and not accepted;
    when 'remove' then
      delete from public.arcade_friendships where accepted and
        ((sender = me and recipient = peer) or (sender = peer and recipient = me));
    else raise exception 'Azione non valida.';
  end case;
end;
$$;

create or replace function public.arcade_friends_list()
returns table(username text, bio text, avatar text, relationship text, game text)
language sql stable security definer set search_path = '' as $$
  select coalesce(p.username, split_part(u.email, '@', 1)), coalesce(p.bio, ''),
         coalesce(p.avatar, ''),
         case when f.accepted then 'friend' when f.sender = auth.uid() then 'outgoing' else 'incoming' end,
         case when f.accepted and activity.seen_at > now() - interval '45 seconds' then activity.game end
  from public.arcade_friendships f
  join auth.users u on u.id = case when f.sender = auth.uid() then f.recipient else f.sender end
  left join public.arcade_profiles p on p.user_id = u.id
  left join public.arcade_presence activity on activity.user_id = u.id and f.accepted
  where f.sender = auth.uid() or f.recipient = auth.uid()
  order by 1;
$$;

create or replace function public.arcade_set_presence(game_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then return; end if;
  if game_id is null then
    delete from public.arcade_presence where user_id = me;
  elsif game_id ~ '^[a-z0-9-]{1,80}$' then
    insert into public.arcade_presence (user_id, game, seen_at) values (me, game_id, now())
    on conflict (user_id) do update set game = excluded.game, seen_at = excluded.seen_at;
  end if;
end;
$$;

revoke all on function public.arcade_friend_action(text,text), public.arcade_friends_list(),
  public.arcade_set_presence(text) from public, anon;
grant execute on function public.arcade_friend_action(text,text), public.arcade_friends_list(),
  public.arcade_set_presence(text) to authenticated;
