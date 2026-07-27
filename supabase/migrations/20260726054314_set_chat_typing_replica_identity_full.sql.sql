/*
# Typing indicator: replica identity full

Realtime UPDATE events only emit changed columns unless the table has
REPLICA IDENTITY FULL. chat_typing was missing this, so subsequent typing
upserts (UPDATEs) did not deliver a complete row to subscribers and the
"در حال نوشتن..." indicator never appeared after the first ping.
*/

ALTER TABLE public.chat_typing REPLICA IDENTITY FULL;
