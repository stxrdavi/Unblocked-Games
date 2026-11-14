begin;

create table if not exists public.arcade_visit_presence (
  visit_id uuid primary key,
  visitor_id uuid not null,
  is_member boolean not null,
  playing boolean not null,
  seen_at timestamptz not null
);
create index if not exists arcade_visit_presence_seen on public.arcade_visit_presence (seen_at);
alter table public.arcade_visit_presence enable row level security;
revoke all on public.arcade_visit_presence from public, anon, authenticated;

create or replace function public.arcade_online_counts(
  page_id uuid, guest_id uuid, in_game boolean
)
returns table(online bigint, playing bigint)
language plpgsql security definer set search_path = '' as $$
declare
  member_id uuid := auth.uid();
  identity_id uuid := coalesce(member_id, guest_id);
  active_since timestamptz := statement_timestamp() - interval '70 seconds';
begin
  if page_id is null or identity_id is null or in_game is null then
    raise exception 'Presenza non valida.' using errcode = '22023';
  end if;

  delete from public.arcade_visit_presence where seen_at <= active_since;
  insert into public.arcade_visit_presence (visit_id, visitor_id, is_member, playing, seen_at)
  values (page_id, identity_id, member_id is not null, in_game, statement_timestamp())
  on conflict (visit_id) do update
    set visitor_id = excluded.visitor_id, is_member = excluded.is_member,
        playing = excluded.playing, seen_at = excluded.seen_at;

  return query
  select count(*), count(*) filter (where active.in_game)
  from (
    select bool_or(p.playing) as in_game
    from public.arcade_visit_presence p
    where p.seen_at > active_since
    group by p.is_member, p.visitor_id
  ) active;
end;
$$;

revoke all on function public.arcade_online_counts(uuid,uuid,boolean) from public;
grant execute on function public.arcade_online_counts(uuid,uuid,boolean) to anon, authenticated;

commit;
