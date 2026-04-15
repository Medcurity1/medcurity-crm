-- Allow admins to hard-delete records for cleaning up bad imports

DROP POLICY IF EXISTS "accounts_delete_admin" ON public.accounts;
CREATE POLICY "accounts_delete_admin"
  ON public.accounts FOR DELETE TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "contacts_delete_admin" ON public.contacts;
CREATE POLICY "contacts_delete_admin"
  ON public.contacts FOR DELETE TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "opportunities_delete_admin" ON public.opportunities;
CREATE POLICY "opportunities_delete_admin"
  ON public.opportunities FOR DELETE TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "products_delete_admin" ON public.products;
CREATE POLICY "products_delete_admin"
  ON public.products FOR DELETE TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "price_books_delete_admin" ON public.price_books;
CREATE POLICY "price_books_delete_admin"
  ON public.price_books FOR DELETE TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "opportunity_products_delete_admin" ON public.opportunity_products;
CREATE POLICY "opportunity_products_delete_admin"
  ON public.opportunity_products FOR DELETE TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "activities_delete_admin" ON public.activities;
CREATE POLICY "activities_delete_admin"
  ON public.activities FOR DELETE TO authenticated
  USING (public.is_admin());
