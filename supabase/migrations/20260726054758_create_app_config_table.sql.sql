/*
# App config (VAPID keys for web push)

## Summary
A small key-value config table for app-wide settings that edge functions need
(such as VAPID public/private keys for web push). Edge functions read these
with the service role key, which bypasses RLS.

## New Tables
- `app_config`
  - `key` (text, primary key)
  - `value` (text, not null)

## Security
- RLS enabled with NO policies. The table is only accessible via the service
  role key (used by edge functions). Frontend clients cannot read or write it.
*/

CREATE TABLE IF NOT EXISTS public.app_config (
  key text PRIMARY KEY,
  value text NOT NULL
);

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

INSERT INTO public.app_config (key, value) VALUES
  ('vapid_public_key', 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEmHN5IKFHA1bbTIaK6MM26aujKvf-ZJv1kT_IfkXi2JKCJoD0P9Rc8EpvkLIWdwIqiHLTFj4jXmEsEScN3sFM7A'),
  ('vapid_private_key', 'MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgb0_elramotnR5Ndu7fYG5f50t0RlL7jKY-uOH1cPM0ehRANCAASYc3kgoUcDVttMhorowzbpq6Mq9_5km_WRP8h-ReLYkoImgPQ_1FzwSm-QshZ3AiqIctMWPiNeYSwRJw3ewUzs')
ON CONFLICT (key) DO NOTHING;
