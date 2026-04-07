-- Database function to create CRM users directly (bypasses Edge Function + email system)
-- Called from the frontend via supabase.rpc('create_crm_user', {...})
-- Only admins can call this (checked via is_admin() RLS helper)

create or replace function public.create_crm_user(
  p_email text,
  p_password text,
  p_full_name text,
  p_role text
)
returns json
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  new_user_id uuid;
  encrypted_pw text;
begin
  -- Only admins can create users
  if not public.is_admin() then
    return json_build_object('error', 'Only admins can create users');
  end if;

  -- Validate role
  if p_role not in ('sales', 'renewals', 'admin') then
    return json_build_object('error', 'Invalid role. Must be sales, renewals, or admin');
  end if;

  -- Validate email not already taken
  if exists (select 1 from auth.users where email = p_email) then
    return json_build_object('error', 'A user with this email already exists');
  end if;

  -- Validate password length
  if length(p_password) < 8 then
    return json_build_object('error', 'Password must be at least 8 characters');
  end if;

  -- Generate user ID and encrypt password
  new_user_id := gen_random_uuid();
  encrypted_pw := crypt(p_password, gen_salt('bf'));

  -- Create the auth user (confirmed immediately, no email sent)
  insert into auth.users (
    id,
    instance_id,
    email,
    encrypted_password,
    email_confirmed_at,
    created_at,
    updated_at,
    raw_app_meta_data,
    raw_user_meta_data,
    aud,
    role,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change
  ) values (
    new_user_id,
    '00000000-0000-0000-0000-000000000000',
    p_email,
    encrypted_pw,
    now(),
    now(),
    now(),
    jsonb_build_object('provider', 'email', 'providers', array['email']),
    jsonb_build_object('full_name', p_full_name),
    'authenticated',
    'authenticated',
    '',
    '',
    '',
    ''
  );

  -- Create the identity record (required for login to work)
  insert into auth.identities (
    id,
    user_id,
    identity_data,
    provider,
    provider_id,
    created_at,
    updated_at,
    last_sign_in_at
  ) values (
    new_user_id,
    new_user_id,
    jsonb_build_object('sub', new_user_id::text, 'email', p_email, 'email_verified', true),
    'email',
    new_user_id::text,
    now(),
    now(),
    now()
  );

  -- Create the user profile
  insert into public.user_profiles (id, full_name, role, is_active)
  values (new_user_id, p_full_name, p_role, true);

  return json_build_object(
    'success', true,
    'user', json_build_object(
      'id', new_user_id,
      'email', p_email,
      'full_name', p_full_name,
      'role', p_role
    )
  );

exception when others then
  return json_build_object('error', sqlerrm);
end;
$$;
