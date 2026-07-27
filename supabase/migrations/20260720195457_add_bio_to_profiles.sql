/*
# Add bio column to profiles

1. Modified Tables
- `profiles`: added `bio` (text, nullable) for user biography.
2. Security
- No policy changes; existing profiles RLS still applies.
*/

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS bio text;
