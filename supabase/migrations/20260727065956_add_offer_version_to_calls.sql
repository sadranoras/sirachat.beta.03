/*
# Add offer_version for call renegotiation

## What changes
1. Adds `offer_version` integer column (default 0) to the `calls` table.
   This tracks renegotiation cycles so both sides can detect when a new
   offer/answer exchange is needed (e.g. audio→video upgrade mid-call).

## Security
- No RLS policy changes needed; existing update policies on `calls` already
  allow both caller and callee to update the row.
*/

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS offer_version integer NOT NULL DEFAULT 0;
