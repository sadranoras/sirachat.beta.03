-- Fix RLS recursion on profiles UPDATE policies.
-- The profiles_update_admin policy does `SELECT 1 FROM profiles ...` inside a
-- policy ON profiles, which causes infinite recursion and breaks ALL updates
-- (including the non-admin profiles_update_own policy). Replace the subquery
-- with a SECURITY DEFINER function that bypasses RLS.

CREATE OR REPLACE FUNCTION public.is_admin_user(uid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM public.profiles WHERE id = uid),
    false
  );
$$;

-- Replace the recursive admin UPDATE policy with one that uses the helper.
DROP POLICY IF EXISTS profiles_update_admin ON profiles;
CREATE POLICY profiles_update_admin ON profiles FOR UPDATE
  TO authenticated
  USING (public.is_admin_user(auth.uid()))
  WITH CHECK (public.is_admin_user(auth.uid()));

-- Also fix the DELETE policy which has the same recursion problem.
DROP POLICY IF EXISTS profiles_delete_admin ON profiles;
CREATE POLICY profiles_delete_admin ON profiles FOR DELETE
  TO authenticated
  USING (public.is_admin_user(auth.uid()));
