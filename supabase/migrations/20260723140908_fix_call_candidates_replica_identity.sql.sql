-- Ensure call_candidates has REPLICA IDENTITY FULL for proper realtime on UPDATE/DELETE
ALTER TABLE public.call_candidates REPLICA IDENTITY FULL;

-- Ensure messages has REPLICA IDENTITY FULL (was mixed in prior state)
ALTER TABLE public.messages REPLICA IDENTITY FULL;

-- Add updated_at trigger to calls if not exists (helps realtime detect changes)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS calls_updated_at ON public.calls;
CREATE TRIGGER calls_updated_at BEFORE UPDATE ON public.calls
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
