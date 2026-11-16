begin;
create table if not exists public.game_saves (
  user_id uuid not null references auth.users(id) on delete cascade,
  game_id text not null, save_key text not null, save_value text not null,
  primary key (user_id, game_id, save_key)
);
alter table public.game_saves enable row level security;
revoke all on public.game_saves from public, anon;

create or replace function public.arcade_sync_game(game_name text, changes jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  member uuid := auth.uid();
  allowed text[];
begin
  allowed := case game_name
    when '2048' then array['gameState', 'bestScore']
    when 'cookie-clicker' then array['CookieClickerGame', 'CookieClickerGameBeta']
    when 'blackjack' then array['arcade-blackjack-balance']
  end;
  if member is null or allowed is null or not exists (
    select 1 from auth.users u where u.id = member and (u.banned_until is null or u.banned_until <= now())
  ) then raise exception 'Salvataggio non autorizzato.' using errcode = '42501'; end if;
  if changes is not null then
    if jsonb_typeof(changes) <> 'object' or octet_length(changes::text) > 1048576 or exists (
      select 1 from jsonb_each(changes) e
      where not (e.key = any(allowed)) or jsonb_typeof(e.value) not in ('null','string')
        or char_length(e.value #>> '{}') > 131072
    ) then raise exception 'Salvataggio non valido.' using errcode = '22023'; end if;
    insert into public.game_saves(user_id, game_id, save_key, save_value)
    select member, game_name, 'arcade-v1:' || e.key, e.value::text from jsonb_each(changes) e
    on conflict (user_id, game_id, save_key) do update set save_value = excluded.save_value;
  end if;
  return coalesce((select jsonb_object_agg(substr(s.save_key, 11), s.save_value::jsonb)
    from public.game_saves s where s.user_id = member and s.game_id = game_name
    and substr(s.save_key, 1, 10) = 'arcade-v1:' and substr(s.save_key, 11) = any(allowed)), '{}'::jsonb);
end;
$$;
revoke all on function public.arcade_sync_game(text,jsonb) from public, anon;
grant execute on function public.arcade_sync_game(text,jsonb) to authenticated;
commit;
