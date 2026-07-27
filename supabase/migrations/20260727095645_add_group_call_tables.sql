/*
# Multi-party group calls (mesh networking)

## Summary
Adds support for true multi-party group calls where many participants can
join the same call simultaneously (audio + video). Each participant
establishes a direct peer connection with every other participant (mesh
topology). This works well for small-to-medium groups (up to ~8 people).

## New Tables

### call_participants
Tracks who is currently in a group call.
- `id` (uuid, primary key)
- `call_id` (uuid, FK to calls, cascade delete)
- `user_id` (uuid, FK to auth.users, cascade delete)
- `joined_at` (timestamptz, default now())
- `left_at` (timestamptz, nullable — set when user leaves)
- `video_enabled` (boolean, default false — whether this participant has camera on)
- `audio_enabled` (boolean, default true — whether this participant has mic on)
- Unique constraint on (call_id, user_id) to prevent duplicate joins.

### call_signals
Carries WebRTC signaling data (offers, answers, ICE candidates) between
every pair of participants in a group call. Each row is a message from
one participant to another within a call.
- `id` (uuid, primary key)
- `call_id` (uuid, FK to calls, cascade delete)
- `from_user` (uuid, FK to auth.users, cascade delete) — sender
- `to_user` (uuid, FK to auth.users, cascade delete) — recipient
- `type` (text) — 'offer' | 'answer' | 'candidate' | 'renegotiate'
- `payload` (jsonb) — the SDP or ICE candidate data
- `created_at` (timestamptz, default now())

## Modified Tables
- `calls` — add `is_group_call` boolean (default false) to distinguish
  mesh group calls from legacy 1-on-1 calls.

## Security (RLS)
- call_participants: authenticated users can read participants of calls
  they are a member of (via chat membership). Users can insert/update their
  own participant row. Users can delete their own row (leave call).
- call_signals: authenticated users can read signals addressed to them or
  sent by them within a call they're part of. Users can insert signals
  where from_user = auth.uid(). Users can delete their own signals.

## Realtime
- Both tables added to supabase_realtime publication for live updates.
*/

-- Add is_group_call column to calls
ALTER TABLE calls ADD COLUMN IF NOT EXISTS is_group_call boolean NOT NULL DEFAULT false;

-- ============ call_participants table ============
CREATE TABLE IF NOT EXISTS call_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at timestamptz DEFAULT now(),
  left_at timestamptz,
  video_enabled boolean NOT NULL DEFAULT false,
  audio_enabled boolean NOT NULL DEFAULT true,
  UNIQUE (call_id, user_id)
);

ALTER TABLE call_participants ENABLE ROW LEVEL SECURITY;

-- Helper: check if user is a member of the chat that owns this call
-- We inline this in policies via EXISTS subqueries to avoid recursion.

-- SELECT: users can see participants of calls in chats they are a member of
DROP POLICY IF EXISTS "select_call_participants" ON call_participants;
CREATE POLICY "select_call_participants" ON call_participants FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM calls c
      WHERE c.id = call_participants.call_id
      AND (
        c.caller_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM chat_members cm WHERE cm.chat_id = c.chat_id AND cm.user_id = auth.uid()
        )
      )
    )
  );

-- INSERT: user can insert their own participant row if they are a chat member
DROP POLICY IF EXISTS "insert_call_participants" ON call_participants;
CREATE POLICY "insert_call_participants" ON call_participants FOR INSERT
  TO authenticated WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM calls c
      WHERE c.id = call_participants.call_id
      AND EXISTS (
        SELECT 1 FROM chat_members cm WHERE cm.chat_id = c.chat_id AND cm.user_id = auth.uid()
      )
    )
  );

-- UPDATE: user can update their own participant row
DROP POLICY IF EXISTS "update_call_participants" ON call_participants;
CREATE POLICY "update_call_participants" ON call_participants FOR UPDATE
  TO authenticated USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- DELETE: user can delete (leave) their own participant row
DROP POLICY IF EXISTS "delete_call_participants" ON call_participants;
CREATE POLICY "delete_call_participants" ON call_participants FOR DELETE
  TO authenticated USING (user_id = auth.uid());

-- ============ call_signals table ============
CREATE TABLE IF NOT EXISTS call_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  from_user uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_user uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE call_signals ENABLE ROW LEVEL SECURITY;

-- SELECT: users can read signals sent to them or by them
DROP POLICY IF EXISTS "select_call_signals" ON call_signals;
CREATE POLICY "select_call_signals" ON call_signals FOR SELECT
  TO authenticated USING (
    from_user = auth.uid() OR to_user = auth.uid()
  );

-- INSERT: users can send signals from themselves
DROP POLICY IF EXISTS "insert_call_signals" ON call_signals;
CREATE POLICY "insert_call_signals" ON call_signals FOR INSERT
  TO authenticated WITH CHECK (from_user = auth.uid());

-- DELETE: users can delete their own signals (cleanup)
DROP POLICY IF EXISTS "delete_call_signals" ON call_signals;
CREATE POLICY "delete_call_signals" ON call_signals FOR DELETE
  TO authenticated USING (from_user = auth.uid());

-- ============ Indexes ============
CREATE INDEX IF NOT EXISTS idx_call_participants_call_id ON call_participants(call_id) WHERE left_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_call_signals_call_to_user ON call_signals(call_id, to_user, created_at);
CREATE INDEX IF NOT EXISTS idx_call_signals_call_from_user ON call_signals(call_id, from_user, created_at);

-- ============ Realtime ============
ALTER PUBLICATION supabase_realtime ADD TABLE public.call_participants;
ALTER PUBLICATION supabase_realtime ADD TABLE public.call_signals;
