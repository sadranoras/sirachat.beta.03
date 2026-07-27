/*
# Add phone_visible column to profiles

1. Profiles table changes:
   - Add `phone_visible` column (boolean, default true) — controls whether a user's phone number is visible to others in profile view.
   - When false, other users cannot see the phone number; the owner and admins can always see it.

2. Security:
   - No new policies needed; existing profiles SELECT policy already allows reading profiles.
   - The phone_visible flag is enforced in the frontend (ProfileModal) and admin always sees all phones.
*/

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'phone_visible') THEN
    ALTER TABLE profiles ADD COLUMN phone_visible boolean NOT NULL DEFAULT true;
  END IF;
END $$;
