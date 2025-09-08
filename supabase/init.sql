-- ================================
-- Supabase Setup: Users, API Usage, Credits, Trigger, RLS, Indexes
-- ================================

-- Extensions (needed for uuid_generate_v4; Supabase also has pgcrypto/gen_random_uuid)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ================================
-- Tables
-- ================================

-- Mirrors auth.users in a public profile table
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- API usage tracking
CREATE TABLE IF NOT EXISTS public.api_usage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL,
  model TEXT NOT NULL,
  tokens_input INTEGER NOT NULL,
  tokens_output INTEGER NOT NULL,
  cost_usd NUMERIC(10,6) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Per-user credit balance (default $5.000000, 6-decimal precision)
CREATE TABLE IF NOT EXISTS public.user_credits (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance_usd NUMERIC(10,6) NOT NULL DEFAULT 5.000000,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- If table existed previously with a different precision, normalize it:
ALTER TABLE public.user_credits
  ALTER COLUMN balance_usd TYPE NUMERIC(10,6);

-- ================================
-- Trigger: auto-provision public.users & user_credits after auth signup
-- ================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  -- Create public.users row
  INSERT INTO public.users (id, email, created_at, updated_at)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.created_at, NOW()), COALESCE(NEW.created_at, NOW()))
  ON CONFLICT (id) DO NOTHING;

  -- Initialize credits to $5.000000
  INSERT INTO public.user_credits (user_id, balance_usd, updated_at)
  VALUES (NEW.id, 5.000000, NOW())
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ================================
-- Row Level Security (RLS) Policies
-- ================================

-- users
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own data" ON public.users;
CREATE POLICY "Users can view their own data"
  ON public.users
  FOR SELECT
  USING (auth.uid() = id);

-- api_usage
ALTER TABLE public.api_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own API usage" ON public.api_usage;
CREATE POLICY "Users can view their own API usage"
  ON public.api_usage
  FOR SELECT
  USING (auth.uid() = user_id);

-- Admins (by email domain) can view all API usage (read-only)
DROP POLICY IF EXISTS "Admins can view all API usage" ON public.api_usage;
CREATE POLICY "Admins can view all API usage"
  ON public.api_usage
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM auth.users u
      WHERE u.id = auth.uid()
        AND u.email ILIKE '%@grouplabs.ca'
    )
  );

-- user_credits
ALTER TABLE public.user_credits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own credits" ON public.user_credits;
CREATE POLICY "Users can view their own credits"
  ON public.user_credits
  FOR SELECT
  USING (auth.uid() = user_id);

-- Allow ONLY the service role to update credits
DROP POLICY IF EXISTS "Service role can update credits" ON public.user_credits;
CREATE POLICY "Service role can update credits"
  ON public.user_credits
  FOR UPDATE
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ================================
-- Indexes
-- ================================
CREATE INDEX IF NOT EXISTS idx_api_usage_user_id ON public.api_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_created_at ON public.api_usage(created_at);

-- ================================
-- Completion notice
-- ================================
DO $$
BEGIN
  RAISE NOTICE 'Setup complete: tables, trigger, RLS, and indexes created. user_credits.balance_usd is NUMERIC(10,6).';
END $$;
