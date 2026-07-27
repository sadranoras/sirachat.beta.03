/*
# RLS Fixes
1. Remove conflicting admin_select_messages (USING true allows ALL users to see ALL messages)
2. Keep messages_select_members as the only SELECT policy for messages
3. Restrict profiles SELECT: users see own profile + admins see all (no more public listing)
4. Keep reactions policies as-is
*/

-- Remove the overly permissive messages SELECT policy
DROP POLICY IF EXISTS "admin_select_messages" ON messages;

-- Remove the overly permissive profiles SELECT policies
DROP POLICY IF EXISTS "admin_select_profiles" ON profiles;
DROP POLICY IF EXISTS "profiles_select_all" ON profiles;

-- New profiles SELECT: self only (admin uses is_admin helper which is SECURITY DEFINER)
CREATE POLICY "profiles_select_own" ON profiles FOR SELECT
  TO authenticated USING (id = auth.uid());

-- Admin can see all profiles
CREATE POLICY "profiles_select_admin" ON profiles FOR SELECT
  TO authenticated USING (public.is_admin(auth.uid()));

-- Remove the overly permissive chat_members SELECT
DROP POLICY IF EXISTS "admin_select_chat_members" ON chat_members;

-- Admin can see all chat_members
CREATE POLICY "chat_members_select_admin" ON chat_members FOR SELECT
  TO authenticated USING (public.is_admin(auth.uid()));
