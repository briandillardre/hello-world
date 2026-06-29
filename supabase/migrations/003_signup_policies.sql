-- Let a newly-signed-up user create their own company + profile.
--
-- 001 only created SELECT policies, so the client-side registration inserts
-- (companies + profiles) were blocked by Row Level Security and the new account
-- ended up with no company attached. These INSERT policies allow a user to
-- create exactly the company/profile rows keyed to their own auth id (the app
-- sets companies.id = profiles.id = auth.users.id at signup).

CREATE POLICY "users create own company" ON companies
  FOR INSERT WITH CHECK (id = auth.uid());

CREATE POLICY "users create own profile" ON profiles
  FOR INSERT WITH CHECK (id = auth.uid());
