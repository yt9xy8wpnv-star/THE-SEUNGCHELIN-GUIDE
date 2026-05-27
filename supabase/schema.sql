create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  username text,
  can_rate boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles
add column if not exists username text;

alter table public.profiles
alter column can_rate set default false;

create unique index if not exists profiles_username_key
on public.profiles (lower(username))
where username is not null;

create table if not exists public.meals (
  id text primary key,
  meal_date date not null,
  meal_slot text not null check (meal_slot in ('breakfast', 'lunch', 'dinner')),
  title text not null,
  menu text[] not null default '{}',
  image_path text,
  created_at timestamptz not null default now()
);

create table if not exists public.ratings (
  id bigint generated always as identity primary key,
  meal_id text not null references public.meals(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  score int not null check (score between 0 and 3),
  one_line_review text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, meal_id)
);

create table if not exists public.best_meals (
  id bigint generated always as identity primary key,
  meal_id text not null unique references public.meals(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.ratings
add column if not exists one_line_review text not null default '';

update public.ratings
set one_line_review = ''
where one_line_review is null;

alter table public.ratings
alter column one_line_review set default '';

alter table public.ratings
alter column one_line_review set not null;

alter table public.ratings
alter column score set default 0;

alter table public.ratings
drop constraint if exists ratings_score_check;

alter table public.ratings
add constraint ratings_score_check check (score between 0 and 3);

alter table public.ratings
drop constraint if exists ratings_one_line_review_words_check;

alter table public.ratings
drop constraint if exists ratings_one_line_review_length_check;

update public.ratings
set one_line_review = left(trim(regexp_replace(one_line_review, '\s+', ' ', 'g')), 30)
where char_length(trim(regexp_replace(one_line_review, '\s+', ' ', 'g'))) > 30
  or one_line_review <> trim(regexp_replace(one_line_review, '\s+', ' ', 'g'));

alter table public.ratings
add constraint ratings_one_line_review_length_check check (
  trim(one_line_review) = ''
  or char_length(trim(one_line_review)) <= 30
);

alter table public.profiles enable row level security;
alter table public.meals enable row level security;
alter table public.ratings enable row level security;
alter table public.best_meals enable row level security;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, username, can_rate)
  values (
    new.id,
    new.email,
    nullif(lower(new.raw_user_meta_data->>'username'), ''),
    false
  )
  on conflict (id) do update set
    email = excluded.email,
    username = coalesce(excluded.username, public.profiles.username);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

insert into public.profiles (id, email, username, can_rate)
select
  id,
  email,
  nullif(lower(raw_user_meta_data->>'username'), ''),
  false
from auth.users
on conflict (id) do update set
  email = excluded.email,
  username = coalesce(excluded.username, public.profiles.username);

create or replace function public.can_current_user_rate()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and can_rate = true
  );
$$;

create or replace function public.get_email_for_username(login_username text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select email
  from public.profiles
  where lower(username) = lower(trim(login_username))
  limit 1;
$$;

grant execute on function public.get_email_for_username(text) to anon, authenticated;

create or replace function public.set_current_user_profile(profile_username text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into public.profiles (id, email, username, can_rate)
  values (
    auth.uid(),
    auth.jwt()->>'email',
    nullif(lower(trim(profile_username)), ''),
    false
  )
  on conflict (id) do update set
    email = excluded.email,
    username = coalesce(excluded.username, public.profiles.username);
end;
$$;

grant execute on function public.set_current_user_profile(text) to authenticated;

create or replace function public.complete_signup_profile(
  new_user_id uuid,
  user_email text,
  profile_username text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, username, can_rate)
  values (
    new_user_id,
    lower(trim(user_email)),
    nullif(lower(trim(profile_username)), ''),
    false
  )
  on conflict (id) do update set
    email = excluded.email,
    username = coalesce(excluded.username, public.profiles.username);
end;
$$;

grant execute on function public.complete_signup_profile(uuid, text, text) to anon, authenticated;

create or replace function public.add_best_meal(target_meal_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.can_current_user_rate() then
    raise exception 'not allowed';
  end if;

  insert into public.best_meals (meal_id, created_by, created_at)
  values (target_meal_id, auth.uid(), now())
  on conflict (meal_id) do update set
    created_by = excluded.created_by,
    created_at = excluded.created_at;

  delete from public.best_meals
  where id in (
    select id
    from public.best_meals
    order by created_at desc, id desc
    offset 10
  );
end;
$$;

grant execute on function public.add_best_meal(text) to authenticated;

create or replace function public.remove_best_meal(target_meal_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.can_current_user_rate() then
    raise exception 'not allowed';
  end if;

  delete from public.best_meals
  where meal_id = target_meal_id;
end;
$$;

grant execute on function public.remove_best_meal(text) to authenticated;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ratings_touch_updated_at on public.ratings;
create trigger ratings_touch_updated_at
  before update on public.ratings
  for each row execute procedure public.touch_updated_at();

drop policy if exists "Meals are readable by everyone" on public.meals;
create policy "Meals are readable by everyone"
on public.meals
for select
to anon, authenticated
using (true);

drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile"
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id);

drop policy if exists "Users can create own profile" on public.profiles;
create policy "Users can create own profile"
on public.profiles
for insert
to authenticated
with check (
  (select auth.uid()) = id
  and can_rate = false
);

drop policy if exists "Users can update own unapproved profile" on public.profiles;
create policy "Users can update own unapproved profile"
on public.profiles
for update
to authenticated
using (
  (select auth.uid()) = id
  and can_rate = false
)
with check (
  (select auth.uid()) = id
  and can_rate = false
);

drop policy if exists "Ratings are readable by everyone" on public.ratings;
create policy "Ratings are readable by everyone"
on public.ratings
for select
to anon, authenticated
using (true);

drop policy if exists "Best meals are readable by everyone" on public.best_meals;
create policy "Best meals are readable by everyone"
on public.best_meals
for select
to anon, authenticated
using (true);

drop policy if exists "Permitted users can create own ratings" on public.ratings;
create policy "Permitted users can create own ratings"
on public.ratings
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and public.can_current_user_rate()
);

drop policy if exists "Permitted users can update own ratings" on public.ratings;
create policy "Permitted users can update own ratings"
on public.ratings
for update
to authenticated
using (
  (select auth.uid()) = user_id
  and public.can_current_user_rate()
)
with check (
  (select auth.uid()) = user_id
  and public.can_current_user_rate()
);

delete from public.meals
where id in ('breakfast', 'lunch', 'dinner');

-- 회원가입 시 이메일은 앱에서 username || '@seungchelin.local' 형태로 자동 생성합니다.
-- 예: username이 student01이면 profiles.email은 student01@seungchelin.local 입니다.
--
-- 평가 권한 부여 예시:
-- update public.profiles
-- set can_rate = true
-- where username = 'student01';
