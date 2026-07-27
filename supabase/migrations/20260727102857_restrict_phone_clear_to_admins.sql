-- Non-admins cannot clear their own phone field.
-- Admins can clear phone on any profile.
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id AND (phone IS NOT NULL OR is_admin_user(auth.uid())));

DROP POLICY IF EXISTS profiles_update_admin ON public.profiles;
CREATE POLICY "profiles_update_admin" ON public.profiles FOR UPDATE
  TO authenticated
  USING (is_admin_user(auth.uid()))
  WITH CHECK (is_admin_user(auth.uid()));