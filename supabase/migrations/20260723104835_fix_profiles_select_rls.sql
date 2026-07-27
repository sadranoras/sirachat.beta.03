/*
# Fix: Allow authenticated users to read all profiles
The messages query joins with profiles (sender:profiles(*)) to get sender info.
RLS blocking other users' profiles causes the entire query to return empty.
The "users not visible in new chat" requirement is handled at the UI level (search-only).
*/

-- Drop restrictive policies
DROP POLICY IF EXISTS "profiles_select_own" ON profiles;
DROP POLICY IF EXISTS "profiles_select_admin" ON profiles;

-- Allow all authenticated users to read profiles (needed for joins)
CREATE POLICY "profiles_select_all" ON profiles FOR SELECT
  TO authenticated USING (true);
