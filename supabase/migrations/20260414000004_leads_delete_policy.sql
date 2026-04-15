-- Allow admins to hard-delete leads (for cleaning up bad imports)
CREATE POLICY "leads_delete_admin"
  ON public.leads
  FOR DELETE
  TO authenticated
  USING (public.is_admin());
