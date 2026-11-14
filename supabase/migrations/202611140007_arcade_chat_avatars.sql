begin;

create or replace function public.arcade_global_profiles()
returns table(id bigint, username text, body text, sent_at timestamptz, avatar text, bio text, has_profile boolean)
language sql stable security definer set search_path = '' as $$
  select m.id, coalesce(p.username, split_part(u.email, '@', 1), m.username),
         m.body, m.sent_at, p.avatar, p.bio, u.id is not null
  from (select * from public.arcade_global_messages order by id desc limit 60) m
  left join auth.users u on not m.is_guest and u.id = m.actor
  left join public.arcade_profiles p on p.user_id = u.id
  order by m.id;
$$;

create or replace function public.arcade_friend_chat_profiles(profile_name text, message text default null)
returns table(id bigint, mine boolean, body text, sent_at timestamptz, avatar text)
language sql security definer set search_path = '' as $$
  select c.id, c.mine, c.body, c.sent_at,
         case when c.mine then
           (select p.avatar from public.arcade_profiles p where p.user_id = auth.uid())
         else
           (select p.avatar from auth.users u
            left join public.arcade_profiles p on p.user_id = u.id
            where u.email ~ '^[a-z0-9_.-]{3,24}@arcade[.]invalid$'
              and coalesce(p.username, split_part(u.email, '@', 1)) = profile_name)
         end
  from public.arcade_friend_chat(profile_name, message) c
  order by c.id;
$$;

revoke all on function public.arcade_global_profiles(), public.arcade_friend_chat_profiles(text,text) from public, anon;
grant execute on function public.arcade_global_profiles() to anon, authenticated;
grant execute on function public.arcade_friend_chat_profiles(text,text) to authenticated;
commit;
