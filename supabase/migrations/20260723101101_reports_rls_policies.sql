/*
# RLS Policies for Reports Table — Admin Access

1. Purpose
- Allow authenticated users to INSERT reports (report other users).
- Allow admins to SELECT and UPDATE all reports.
- Regular users can only see their own submitted reports.

2. Policy Changes
- reports SELECT: admin sees all, users see their own reports
- reports INSERT: any authenticated user can create a report
- reports UPDATE: only admins can change report status
*/

-- Helper function already exists from previous migration (public.is_admin)

-- reports: admin can read all, users can read their own
DROP POLICY IF EXISTS "select_reports" ON reports;
CREATE POLICY "select_reports" ON reports FOR SELECT
TO authenticated USING (public.is_admin(auth.uid()) OR reporter_id = auth.uid());

-- reports: any authenticated user can insert (create a report)
DROP POLICY IF EXISTS "insert_reports" ON reports;
CREATE POLICY "insert_reports" ON reports FOR INSERT
TO authenticated WITH CHECK (reporter_id = auth.uid());

-- reports: only admins can update (change status)
DROP POLICY IF EXISTS "update_reports" ON reports;
CREATE POLICY "update_reports" ON reports FOR UPDATE
TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
