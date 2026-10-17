-- Test-only transition: enrich users and deliberately remove one profile's entries.
ALTER TABLE public.users ADD COLUMN profile_kind text NOT NULL DEFAULT 'unclassified';
UPDATE public.users SET profile_kind = split_part(email, '@', 1);
DELETE FROM public.daily_entries
WHERE user_id = (SELECT id FROM public.users WHERE email = 'daily@example.test');
CREATE SEQUENCE public.rehearsal_counter;
SELECT nextval('public.rehearsal_counter');
