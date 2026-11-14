begin;

create table if not exists public.arcade_global_messages (
  id bigint generated always as identity primary key,
  actor uuid not null,
  is_guest boolean not null,
  username text not null,
  body text not null check (char_length(body) between 1 and 500),
  sent_at timestamptz not null default now()
);
create index if not exists arcade_global_actor_time on public.arcade_global_messages (is_guest, actor, sent_at desc);
alter table public.arcade_global_messages enable row level security;
revoke all on public.arcade_global_messages from public, anon, authenticated;

create or replace function public.arcade_global_read()
returns table(id bigint, username text, body text, sent_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select recent.id, recent.username, recent.body, recent.sent_at
  from (select m.id, m.username, m.body, m.sent_at
        from public.arcade_global_messages m order by m.id desc limit 60) recent
  order by recent.id;
$$;

create or replace function public.arcade_global_send(guest_id uuid, message text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  member uuid := auth.uid();
  guest boolean := member is null;
  author_id uuid := coalesce(member, guest_id);
  author_name text;
  clean text := regexp_replace(message, '^[[:space:]]+|[[:space:]]+$', '', 'g');
begin
  if author_id is null or clean is null or char_length(clean) not between 1 and 500 then
    raise exception 'Scrivi un messaggio da 1 a 500 caratteri.';
  end if;
  if guest then
    author_name := 'Ospite ' || upper(right(author_id::text, 5));
  else
    select coalesce(p.username, split_part(u.email, '@', 1)) into author_name
    from auth.users u left join public.arcade_profiles p on p.user_id = u.id
    where u.id = member and (u.banned_until is null or u.banned_until <= now())
      and u.email ~ '^[a-z0-9_.-]{3,24}@arcade[.]invalid$';
    if author_name is null then raise exception 'Account non autorizzato.' using errcode = '42501'; end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(guest::text || author_id::text, 0));
  if exists (select 1 from public.arcade_global_messages m
    where m.actor = author_id and m.is_guest = guest and m.sent_at > now() - interval '3 seconds') then
    raise exception 'Aspetta qualche secondo prima di inviare un altro messaggio.';
  end if;
  insert into public.arcade_global_messages(actor, is_guest, username, body)
  values (author_id, guest, author_name, clean);
end;
$$;

revoke all on function public.arcade_global_read(), public.arcade_global_send(uuid,text) from public;
grant execute on function public.arcade_global_read(), public.arcade_global_send(uuid,text) to anon, authenticated;
commit;
