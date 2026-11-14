begin;

create table if not exists public.arcade_owner (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null references auth.users(id) on delete cascade
);
alter table public.arcade_owner enable row level security;
revoke all on public.arcade_owner from public, anon, authenticated;

insert into public.arcade_owner (user_id)
select id from auth.users where lower(email) = 'davidemace_@arcade.invalid'
on conflict (singleton) do nothing;

do $$
begin
  if not exists (select 1 from public.arcade_owner) then
    raise exception 'Account Arcade originale davidemace_ non trovato.';
  end if;
end;
$$;

create or replace function public.arcade_account_status()
returns table(is_owner boolean, banned boolean)
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.arcade_owner o where o.user_id = u.id),
         coalesce(u.banned_until > now(), false)
  from auth.users u where u.id = auth.uid();
$$;

create or replace function public.arcade_public_owner()
returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(p.username, split_part(u.email, '@', 1))
  from public.arcade_owner o
  join auth.users u on u.id = o.user_id
  left join public.arcade_profiles p on p.user_id = u.id;
$$;

create or replace function public.arcade_moderate(profile_name text, action text)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare target uuid;
begin
  if not exists (
    select 1 from public.arcade_owner o join auth.users u on u.id = o.user_id
    where o.user_id = auth.uid() and (u.banned_until is null or u.banned_until <= now())
  ) then
    raise exception 'Accesso riservato al proprietario.' using errcode = '42501';
  end if;

  select u.id into target
  from auth.users u left join public.arcade_profiles p on p.user_id = u.id
  where u.email ~ '^[a-z0-9_.-]{3,24}@arcade[.]invalid$'
    and coalesce(p.username, split_part(u.email, '@', 1)) = lower(trim(profile_name));
  if target is null then raise exception 'Utente non trovato.'; end if;
  if target = auth.uid() then raise exception 'Non puoi bannare il proprietario.'; end if;

  case action
    when 'ban' then
      update auth.users set banned_until = now() + interval '100 years' where id = target;
      delete from auth.sessions where user_id = target;
    when 'unban' then
      update auth.users set banned_until = null where id = target;
    when 'status' then null;
    else raise exception 'Azione non valida.';
  end case;

  return exists (select 1 from auth.users where id = target and banned_until > now());
end;
$$;

revoke all on function public.arcade_account_status(), public.arcade_moderate(text,text) from public, anon;
grant execute on function public.arcade_account_status(), public.arcade_moderate(text,text) to authenticated;
revoke all on function public.arcade_public_owner() from public;
grant execute on function public.arcade_public_owner() to anon, authenticated;

commit;
