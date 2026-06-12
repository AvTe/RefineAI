-- RefineAI Database Schema Migration
-- Consolidated schema setup: Profiles table, RLS, triggers, and admin functions

-- 1. Create profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  words_used integer DEFAULT 0,
  daily_limit integer DEFAULT 2000,
  last_reset_date text,
  is_premium boolean DEFAULT false,
  plan_type text DEFAULT 'free',
  subscription_expires_at timestamp with time zone,
  subscription_id text,
  total_words_all_time integer DEFAULT 0
);

-- 2. Enable Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 3. Create RLS Policies
DROP POLICY IF EXISTS "Allow select for self" ON public.profiles;
CREATE POLICY "Allow select for self" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "Allow update for self" ON public.profiles;
CREATE POLICY "Allow update for self" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Allow insert for self" ON public.profiles;
CREATE POLICY "Allow insert for self" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- 4. Create trigger to update daily_limit based on plan_type
-- Free: 2000, Pro: 20000, Premium: unlimited (999999)
CREATE OR REPLACE FUNCTION public.get_daily_limit(plan text)
RETURNS integer AS $$
BEGIN
  CASE plan
    WHEN 'premium' THEN RETURN 999999;
    WHEN 'pro' THEN RETURN 20000;
    ELSE RETURN 2000;
  END CASE;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.update_daily_limit_on_plan_change()
RETURNS trigger AS $$
BEGIN
  IF NEW.plan_type IS DISTINCT FROM OLD.plan_type THEN
    NEW.daily_limit := public.get_daily_limit(NEW.plan_type);
    IF NEW.plan_type IN ('pro', 'premium') THEN
      NEW.is_premium := true;
    ELSE
      NEW.is_premium := false;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_daily_limit ON public.profiles;
CREATE TRIGGER trigger_update_daily_limit
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_daily_limit_on_plan_change();

-- 5. Create function to manually upgrade a user (admin use)
CREATE OR REPLACE FUNCTION public.upgrade_user_plan(user_id uuid, new_plan text, expires_at timestamp with time zone DEFAULT NULL)
RETURNS void AS $$
BEGIN
  UPDATE public.profiles
  SET 
    plan_type = new_plan,
    is_premium = (new_plan IN ('pro', 'premium')),
    daily_limit = public.get_daily_limit(new_plan),
    subscription_expires_at = expires_at
  WHERE id = user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.upgrade_user_plan TO authenticated;

-- 6. Setup auto-profile creation trigger for new users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, words_used, daily_limit, last_reset_date, is_premium, plan_type)
  VALUES (
    new.id,
    new.email,
    0,
    2000,
    to_char(now(), 'YYYY-MM-DD'),
    false,
    'free'
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
