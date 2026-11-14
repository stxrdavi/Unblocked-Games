-- Return public profile fields only. Accounts with no edited profile still
-- appear under their original Arcade username.
create or replace function public.arcade_search_profiles(query text)
returns table(username text, bio text, avatar text)
language sql stable security definer set search_path = '' as $$
  select member.username, member.bio, member.avatar
  from (
    select coalesce(p.username, split_part(u.email, '@', 1)) as username,
           coalesce(p.bio, '') as bio, coalesce(p.avatar, '') as avatar
    from auth.users u
    left join public.arcade_profiles p on p.user_id = u.id
    where u.email ~ '^[a-z0-9_.-]{3,24}@arcade[.]invalid$'
  ) member
  where query ~ '^[a-z0-9_.-]{2,24}$'
    and strpos(member.username, query) > 0
  order by (member.username = query) desc,
           (strpos(member.username, query) = 1) desc, member.username
  limit 8;
$$;

revoke all on function public.arcade_search_profiles(text) from public;
grant execute on function public.arcade_search_profiles(text) to anon, authenticated;
