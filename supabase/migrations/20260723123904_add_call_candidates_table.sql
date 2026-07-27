CREATE TABLE IF NOT EXISTS public.call_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id uuid NOT NULL REFERENCES public.calls(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  candidate jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.call_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "call_candidates_insert_participant"
  ON public.call_candidates FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.calls c WHERE c.id = call_id AND (c.caller_id = auth.uid() OR c.callee_id = auth.uid()))
  );

CREATE POLICY "call_candidates_select_participant"
  ON public.call_candidates FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.calls c WHERE c.id = call_id AND (c.caller_id = auth.uid() OR c.callee_id = auth.uid()))
  );

CREATE INDEX idx_call_candidates_call_id ON public.call_candidates(call_id);
