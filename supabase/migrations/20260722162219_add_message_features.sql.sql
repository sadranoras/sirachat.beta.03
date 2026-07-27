-- Add new columns to messages for edit/pin/reply/soft-delete
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS is_edited boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_pinned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reply_to uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone;

-- Create reactions table
CREATE TABLE IF NOT EXISTS public.reactions (
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

ALTER TABLE public.reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "reactions_select_members" ON public.reactions
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.chat_members cm
      JOIN public.messages m ON m.id = reactions.message_id
      WHERE cm.chat_id = m.chat_id AND cm.user_id = auth.uid()
    )
  );

CREATE POLICY "reactions_insert_own" ON public.reactions
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.chat_members cm
      JOIN public.messages m ON m.id = reactions.message_id
      WHERE cm.chat_id = m.chat_id AND cm.user_id = auth.uid()
    )
  );

CREATE POLICY "reactions_update_own" ON public.reactions
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "reactions_delete_own" ON public.reactions
  FOR DELETE TO authenticated USING (user_id = auth.uid());
