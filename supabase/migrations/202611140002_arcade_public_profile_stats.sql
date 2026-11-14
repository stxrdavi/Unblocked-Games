create or replace function public.arcade_public_profile_stats(profile_name text)
returns table(total_seconds bigint, favorite_game text)
language sql stable security definer set search_path = '' as $$
  with member as (
    select u.id
    from auth.users u
    left join public.arcade_profiles p on p.user_id = u.id
    where profile_name ~ '^[a-z0-9_.-]{3,24}$'
      and u.email ~ '^[a-z0-9_.-]{3,24}@arcade[.]invalid$'
      and coalesce(p.username, split_part(u.email, '@', 1)) = profile_name
  ), games as (
    select t.game, count(*) as ticks
    from public.arcade_play_ticks t
    join member m on m.id = t.user_id
    group by t.game
  )
  select coalesce((select sum(ticks) * 30 from games), 0)::bigint,
         (select game from games order by ticks desc, game limit 1)
  where exists (select 1 from member);
$$;

revoke all on function public.arcade_public_profile_stats(text) from public;
grant execute on function public.arcade_public_profile_stats(text) to anon, authenticated;
