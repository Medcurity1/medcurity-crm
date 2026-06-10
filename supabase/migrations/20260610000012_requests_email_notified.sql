-- ---------------------------------------------------------------------
-- Requests: track when the email notice for a request was sent.
--
-- The request-email-notify edge function compare-and-swaps this column
-- (set where null) before sending, so repeated/abusive invocations can
-- never send duplicate emails for the same request. Null = not yet
-- emailed (the function resets it to null if the send fails, allowing a
-- retry).
-- ---------------------------------------------------------------------

begin;

alter table public.requests
  add column if not exists email_notified_at timestamptz;

commit;

notify pgrst, 'reload schema';
