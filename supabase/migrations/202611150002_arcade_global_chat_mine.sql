begin;

create or replace function public.arcade_global_messages_for_viewer(guest_id uuid default null)
returns table(id bigint, username text, body text, sent_at timestamptz, avatar text, bio text, has_profile boolean, mine boolean)
language sql stable security definer set search_path = '' as $$
  select m.id, coalesce(p.username, split_part(u.email, '@', 1), m.username),
         m.body, m.sent_at, p.avatar, p.bio, u.id is not null,
         coalesce(case when auth.uid() is null
           then m.is_guest and m.actor = guest_id
           else not m.is_guest and m.actor = auth.uid()
         end, false)
  from (select * from public.arcade_global_messages order by id desc limit 60) m
  left join auth.users u on not m.is_guest and u.id = m.actor
  left join public.arcade_profiles p on p.user_id = u.id
  order by m.id;
$$;

revoke all on function public.arcade_global_messages_for_viewer(uuid) from public;
grant execute on function public.arcade_global_messages_for_viewer(uuid) to anon, authenticated;
commit;
