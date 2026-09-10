-- Server-side enforcement of the per-plan attendee cap.
--
-- The client (src/lib/constants.js PLANS) already stops the "Max Attendees"
-- stepper on CreateSession at the host's plan limit, but that's just UI —
-- nothing previously stopped a direct API/insert call from setting
-- sessions.max_attendees to anything at all. This adds the real backstop.
--
-- These numbers are hand-kept in sync with src/lib/constants.js PLANS
-- (maxAttendees). There's no single source both Postgres and JS can read
-- from here, so if you ever change one, change the other:
--   free -> 20, pro -> 30, max -> 40, premium -> 50

create or replace function public.plan_max_attendees(plan_key text)
returns integer
language sql
immutable
as $$
  select case plan_key
    when 'pro'     then 30
    when 'max'     then 40
    when 'premium' then 50
    else 20 -- 'free', null, or any unrecognized plan value
  end;
$$;

-- A plain CHECK constraint can't see another table's row, so the actual
-- enforcement has to be a trigger: look up the host's plan on
-- insert/update and compare against plan_max_attendees().
create or replace function public.enforce_session_attendee_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  host_plan text;
  allowed_max integer;
begin
  select plan into host_plan from public.profiles where id = new.host_id;
  allowed_max := public.plan_max_attendees(host_plan);

  if new.max_attendees > allowed_max then
    raise exception
      'max_attendees (%) exceeds the % plan limit of %',
      new.max_attendees, coalesce(host_plan, 'free'), allowed_max
      using errcode = '23514'; -- check_violation, so error-handling code
                               -- expecting a constraint-style failure
                               -- still works without special-casing this
  end if;

  return new;
end;
$$;

drop trigger if exists sessions_enforce_attendee_limit on public.sessions;

create trigger sessions_enforce_attendee_limit
before insert or update of max_attendees, host_id on public.sessions
for each row
execute function public.enforce_session_attendee_limit();
