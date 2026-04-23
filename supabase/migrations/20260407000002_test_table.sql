-- Test table
CREATE TABLE public.test (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_name text NOT NULL,
  test_description text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.test ENABLE ROW LEVEL SECURITY;

CREATE POLICY "test_select_authenticated" ON public.test
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "test_insert_authenticated" ON public.test
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "test_update_authenticated" ON public.test
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "test_delete_authenticated" ON public.test
  FOR DELETE TO authenticated USING (true);
