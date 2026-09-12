-- Fixes: Hosting/Recording minutes on Profile don't reflect a plan
-- upgrade until the next calendar month.
--
-- ensure_current_period() only computes host_minutes_balance /
-- recording_minutes_balance from the user's plan at the MOMENT a
-- usage_ledger row is first created for that month:
--
--   SELECT * INTO row_out FROM usage_ledger WHERE user_id = ... AND period = this_period;
--   IF FOUND THEN RETURN row_out; END IF;   -- <-- never re-checks plan after this
--
-- So upgrading mid-month correctly updates profiles.plan, but the
-- current month's row already exists and just keeps returning whatever
-- allowance was frozen in at creation time — the new plan's higher
-- allowance doesn't show up until next month's row is created fresh.
--
-- Rather than touch ensure_current_period()'s rollover-from-last-month
-- logic (subtle, and correct as-is), this adds a trigger that tops up
-- the CURRENT period's row by exactly the difference in allowance
-- whenever plan changes — so someone with 12 host minutes left on Free
-- who upgrades to Pro (30 -> 90) ends that instant with 72 left
-- (12 + 60), not a full fresh 90 (which would erase minutes they'd
-- already banked from a previous month's rollover) and not the old 12
-- (which would ignore the upgrade until next month).
--
-- If no row exists yet for this period, there's nothing to top up —
-- ensure_current_period() will compute the new plan's correct starting
-- balance the first time it's called, so this deliberately does nothing
-- in that case rather than risk creating a duplicate/out-of-sequence row.
create or replace function public.sync_usage_on_plan_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  this_period date := date_trunc('month', now())::date;
  host_delta integer;
  recording_delta integer;
begin
  if new.plan is distinct from old.plan then
    host_delta := public.plan_host_minutes(new.plan) - public.plan_host_minutes(old.plan);
    recording_delta := public.plan_recording_minutes(new.plan) - public.plan_recording_minutes(old.plan);

    update public.usage_ledger
    set host_minutes_balance = greatest(0, host_minutes_balance + host_delta),
        recording_minutes_balance = greatest(0, recording_minutes_balance + recording_delta)
    where user_id = new.id and period = this_period;
  end if;

  return new;
end;
$function$;

drop trigger if exists profiles_sync_usage_on_plan_change on public.profiles;

create trigger profiles_sync_usage_on_plan_change
after update of plan on public.profiles
for each row
execute function public.sync_usage_on_plan_change();
