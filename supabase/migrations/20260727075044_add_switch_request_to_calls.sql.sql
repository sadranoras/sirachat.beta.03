/*
# Add switch_request to calls table

1. Changes
- Adds `switch_request` (jsonb, nullable) column to `public.calls`.
  Stores an in-call request to switch between audio and video, structured as:
  { to_video: boolean, requested_by: uuid, status: 'pending' | 'accepted' | 'rejected' }
  - to_video: the target mode the requester wants to switch to.
  - requested_by: the profile id of the user who initiated the request.
  - status: lifecycle of the request. 'pending' when sent, 'accepted'/'rejected'
    when the other participant responds. Cleared (set to null) after the switch
    is applied so a new request can be made later.
- No RLS policy changes: existing calls update policies already allow both
  caller and callee to update the row, so both participants can write and
  clear the switch_request field.

2. Security
- No new policies. Existing `calls_update_participants` policy covers this column.
*/

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS switch_request jsonb;
