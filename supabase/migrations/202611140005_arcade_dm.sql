begin;

create table if not exists public.arcade_dm (
  id bigint generated always as identity primary key,
  sender uuid not null references auth.users(id) on delete cascade,
  recipient uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 1000),
  sent_at timestamptz not null default now(),
  check (sender <> recipient)
);
create index if not exists arcade_dm_pair on public.arcade_dm
  (least(sender, recipient), greatest(sender, recipient), id desc);
alter table public.arcade_dm enable row level security;
revoke all on public.arcade_dm from public, anon, authenticated;

create or replace function public.arcade_friend_chat(profile_name text, message text default null)
returns table(id bigint, mine boolean, body text, sent_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  peer uuid;
begin
  if me is null or not exists (
    select 1 from auth.users u where u.id = me and (u.banned_until is null or u.banned_until <= now())
  ) then raise exception 'Accesso alla chat non consentito.' using errcode = '42501'; end if;

  select u.id into peer
  from auth.users u
  left join public.arcade_profiles p on p.user_id = u.id
  join public.arcade_friendships f on f.accepted and
    ((f.sender = me and f.recipient = u.id) or (f.recipient = me and f.sender = u.id))
  where profile_name ~ '^[a-z0-9_.-]{3,24}$'
    and u.email ~ '^[a-z0-9_.-]{3,24}@arcade[.]invalid$'
    and coalesce(p.username, split_part(u.email, '@', 1)) = profile_name
    and (u.banned_until is null or u.banned_until <= now())
  for share of f;
  if peer is null then raise exception 'La chat è disponibile tra amici.' using errcode = '42501'; end if;

  if message is not null then
    if char_length(trim(message)) not between 1 and 1000 then
      raise exception 'Scrivi un messaggio da 1 a 1000 caratteri.';
    end if;
    insert into public.arcade_dm(sender, recipient, body) values (me, peer, trim(message));
  end if;

  return query
  select latest.id, latest.sender = me, latest.body, latest.sent_at from (
    select d.id, d.sender, d.body, d.sent_at from public.arcade_dm d
    where least(d.sender, d.recipient) = least(me, peer)
      and greatest(d.sender, d.recipient) = greatest(me, peer)
    order by d.id desc limit 50
  ) latest order by latest.id;
end;
$$;

revoke all on function public.arcade_friend_chat(text,text) from public, anon;
grant execute on function public.arcade_friend_chat(text,text) to authenticated;
commit;
