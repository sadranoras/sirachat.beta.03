/*
# Push notification subscriptions

## Summary
Stores Web Push subscriptions for each user so an edge function can send
browser push notifications when they receive a new message. Each user can
have multiple subscriptions (one per device/browser).

## New Tables
- `push_subscriptions`
  - `id` (uuid, primary key)
  - `user_id` (uuid, references auth.users, the subscription owner)
  - `endpoint` (text, the push service URL, unique per subscription)
  - `p256dh` (text, public key from the browser PushSubscription)
  - `auth` (text, auth secret from the browser PushSubscription)
  - `created_at` (timestamptz, default now())

## Security
- RLS enabled.
- Users can manage only their own subscriptions (select/insert/delete).
- Edge function uses the service role key and bypasses RLS to read all
  subscriptions for a target user when sending notifications.
*/

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, endpoint)
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_push_subs" ON public.push_subscriptions;
CREATE POLICY "select_own_push_subs" ON public.push_subscriptions FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_push_subs" ON public.push_subscriptions;
CREATE POLICY "insert_own_push_subs" ON public.push_subscriptions FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_push_subs" ON public.push_subscriptions;
CREATE POLICY "delete_own_push_subs" ON public.push_subscriptions FOR DELETE
  TO authenticated USING (auth.uid() = user_id);
