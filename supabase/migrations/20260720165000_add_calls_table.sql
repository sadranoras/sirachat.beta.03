/*
# Add call signaling table for WebRTC

1. New Tables
- `calls` — tracks active/ended WebRTC calls between users.
  - id (uuid, PK)
  - chat_id (uuid, references chats) — the chat context
  - caller_id (uuid, references auth.users)
  - callee_id (uuid, references auth.users)
  - status (text: 'ringing' | 'accepted' | 'rejected' | 'ended')
  - offer_sdp (text, nullable) — caller's SDP offer
  - answer_sdp (text, nullable) — callee's SDP answer
  - caller_candidates (jsonb, nullable) — ICE candidates from caller
  - callee_candidates (jsonb, nullable) — ICE candidates from callee
  - created_at (timestamptz)
  - updated_at (timestamptz)

2. Security (RLS)
- Either participant in the call can read/update.
- Caller can insert.
- Realtime enabled.

3. Notes
- ICE candidates stored as jsonb arrays (simpler than separate table for this scope).
- Calls are scoped to a chat (direct or group). For group calls, callee_id = the invited user; multi-party would need a different model — kept 1:1 for now.
*/

CREATE TABLE IF NOT EXISTS calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  caller_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  callee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'ringing' CHECK (status IN ('ringing','accepted','rejected','ended')),
  offer_sdp text,
  answer_sdp text,
  caller_candidates jsonb DEFAULT '[]'::jsonb,
  callee_candidates jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "calls_select_participants" ON calls;
CREATE POLICY "calls_select_participants" ON calls FOR SELECT
  TO authenticated USING (
    caller_id = auth.uid() OR callee_id = auth.uid()
  );

DROP POLICY IF EXISTS "calls_insert_caller" ON calls;
CREATE POLICY "calls_insert_caller" ON calls FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = caller_id);

DROP POLICY IF EXISTS "calls_update_participants" ON calls;
CREATE POLICY "calls_update_participants" ON calls FOR UPDATE
  TO authenticated USING (caller_id = auth.uid() OR callee_id = auth.uid())
  WITH CHECK (caller_id = auth.uid() OR callee_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_calls_chat ON calls(chat_id);
CREATE INDEX IF NOT EXISTS idx_calls_callee ON calls(callee_id, status);
CREATE INDEX IF NOT EXISTS idx_calls_caller ON calls(caller_id, status);

ALTER PUBLICATION supabase_realtime ADD TABLE calls;
