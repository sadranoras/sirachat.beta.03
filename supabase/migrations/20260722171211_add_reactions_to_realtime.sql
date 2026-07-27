-- Add reactions table to the realtime publication so postgres_changes events fire for it
ALTER PUBLICATION supabase_realtime ADD TABLE public.reactions;