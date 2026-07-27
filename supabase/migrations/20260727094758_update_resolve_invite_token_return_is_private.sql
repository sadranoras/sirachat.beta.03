-- Replace resolve_invite_token to also return is_private so the frontend
-- can decide whether to show a message preview (public) or a join
-- confirmation panel (private) when an invite link is clicked.
DROP FUNCTION IF EXISTS public.resolve_invite_token(text);

CREATE OR REPLACE FUNCTION public.resolve_invite_token(p_token text)
RETURNS TABLE (id uuid, title text, type text, is_private boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.title, c.type, c.is_private
  FROM chats c
  WHERE c.invite_token = p_token
    AND c.type IN ('group', 'channel')
    AND c.invite_token IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_invite_token(text) TO authenticated;
