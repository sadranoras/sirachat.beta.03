/*
# Fix invite link lookup for private groups/channels

## Problem
When a user clicks an invite link (?join=<token>), the frontend queries
`chats` by `invite_token`. However, RLS on `chats` hides private groups/channels
from non-members, so the query returns no rows even when the token is valid.
This causes the "لینک دعوت نامعتبر است" (invalid invite link) error.

## Solution
Create a SECURITY DEFINER function `resolve_invite_token(p_token text)` that
bypasses RLS to look up a chat by its invite_token. The function returns only
the minimal fields needed by the frontend (id, title, type) — it does NOT
expose private message content or member lists. This is safe because:
  - The token is a random secret that the owner explicitly shares.
  - Anyone holding the token is already authorized to join the chat.
  - The function only returns the chat id/title/type, not sensitive data.

## Security
- Function is SECURITY DEFINER, owned by postgres, so it bypasses RLS.
- Returns a minimal row (id, title, type) — no sensitive columns.
- Only matches group/channel chats that actually have an invite_token set.
*/

CREATE OR REPLACE FUNCTION public.resolve_invite_token(p_token text)
RETURNS TABLE (id uuid, title text, type text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.title, c.type
  FROM chats c
  WHERE c.invite_token = p_token
    AND c.type IN ('group', 'channel')
    AND c.invite_token IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_invite_token(text) TO authenticated;
