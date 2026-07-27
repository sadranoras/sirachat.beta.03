
-- Add video column to calls table so callee knows if it's a video call
ALTER TABLE calls ADD COLUMN IF NOT EXISTS video boolean NOT NULL DEFAULT false;

-- Add updated_at trigger for calls
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS calls_updated_at ON calls;
CREATE TRIGGER calls_updated_at BEFORE UPDATE ON calls
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
