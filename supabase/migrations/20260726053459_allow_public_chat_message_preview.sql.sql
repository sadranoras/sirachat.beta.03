/*
# Allow reading messages in public group/channel chats (preview)

## Summary
Currently only chat members can read messages. To support browsing public
groups/channels before joining (Telegram-style discovery), allow any
authenticated user to SELECT messages in non-private group/channel chats.

## Changes
### messages SELECT policy
- Add "messages_select_public" policy: any authenticated user can read
  messages where the parent chat is a public (is_private = false) group or
  channel.
- Keeps the existing member-based policy; this is an additional, narrower path.
*/

DROP POLICY IF EXISTS "messages_select_public" ON messages;
CREATE POLICY "messages_select_public" ON messages FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM chats
      WHERE chats.id = messages.chat_id
        AND chats.type IN ('group', 'channel')
        AND chats.is_private = false
    )
  );
