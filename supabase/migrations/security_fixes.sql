-- RefineAI Security Hardening Migration
-- Fixes critical security vulnerabilities in RLS policies and functions

-- ============================================================
-- 1. REVOKE upgrade_user_plan from authenticated users
-- ============================================================
-- This function was callable by any authenticated user, allowing free upgrades
REVOKE EXECUTE ON FUNCTION public.upgrade_user_plan FROM authenticated;

-- Only service_role (admin/backend) can call it now
GRANT EXECUTE ON FUNCTION public.upgrade_user_plan TO service_role;

COMMENT ON FUNCTION public.upgrade_user_plan IS 
'Admin-only function to upgrade user plans. Only callable by service_role (webhooks/backend).';


-- ============================================================
-- 2. CREATE atomic word increment function (prevents race conditions)
-- ============================================================
CREATE OR REPLACE FUNCTION public.increment_words_used(user_id uuid, words_to_add integer)
RETURNS void AS $$
BEGIN
  IF words_to_add <= 0 THEN
    RAISE EXCEPTION 'words_to_add must be positive';
  END IF;

  UPDATE public.profiles
  SET 
    words_used = words_used + words_to_add,
    total_words_all_time = total_words_all_time + words_to_add
  WHERE id = user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Allow authenticated users to call their own increment
GRANT EXECUTE ON FUNCTION public.increment_words_used TO authenticated;

COMMENT ON FUNCTION public.increment_words_used IS 
'Atomically increments word usage counter. Called by process-ai Edge Function after successful AI response.';


-- ============================================================
-- 3. LOCK DOWN RLS policies - prevent daily_limit and words_used manipulation
-- ============================================================
-- Drop existing policies
DROP POLICY IF EXISTS "Allow update for self" ON public.profiles;

-- Recreate with column restrictions
CREATE POLICY "Allow update for self" ON public.profiles
  FOR UPDATE TO authenticated 
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id 
    AND (
      -- Users can only update their own non-security-critical fields
      -- They CANNOT modify: daily_limit, is_premium, plan_type, subscription_expires_at, subscription_id, words_used, last_reset_date, total_words_all_time
      (daily_limit IS NULL OR daily_limit = (SELECT daily_limit FROM public.profiles WHERE id = auth.uid()))
      AND (is_premium IS NULL OR is_premium = (SELECT is_premium FROM public.profiles WHERE id = auth.uid()))
      AND (plan_type IS NULL OR plan_type = (SELECT plan_type FROM public.profiles WHERE id = auth.uid()))
      AND (subscription_expires_at IS NULL OR subscription_expires_at = (SELECT subscription_expires_at FROM public.profiles WHERE id = auth.uid()))
      AND (subscription_id IS NULL OR subscription_id = (SELECT subscription_id FROM public.profiles WHERE id = auth.uid()))
      AND (words_used IS NULL OR words_used = (SELECT words_used FROM public.profiles WHERE id = auth.uid()))
      AND (last_reset_date IS NULL OR last_reset_date = (SELECT last_reset_date FROM public.profiles WHERE id = auth.uid()))
      AND (total_words_all_time IS NULL OR total_words_all_time = (SELECT total_words_all_time FROM public.profiles WHERE id = auth.uid()))
    )
  );

COMMENT ON POLICY "Allow update for self" ON public.profiles IS 
'Users can update their own profile but CANNOT modify plan-related fields (daily_limit, is_premium, plan_type, etc.)';


-- ============================================================
-- 4. LOCK DOWN INSERT policy - prevent custom daily_limit on signup
-- ============================================================
DROP POLICY IF EXISTS "Allow insert for self" ON public.profiles;

CREATE POLICY "Allow insert for self" ON public.profiles
  FOR INSERT TO authenticated 
  WITH CHECK (
    auth.uid() = id
    AND plan_type IN ('free', 'pro', 'premium')  -- Must be valid plan
    AND daily_limit = public.get_daily_limit(COALESCE(plan_type, 'free'))  -- Must match plan's limit
    AND is_premium = (plan_type IN ('pro', 'premium'))  -- Must match plan type
  );

COMMENT ON POLICY "Allow insert for self" ON public.profiles IS 
'Users can insert their own profile but daily_limit and is_premium must match the plan_type.';


-- ============================================================
-- 5. CREATE server-side daily reset function (replaces client-side logic)
-- ============================================================
CREATE OR REPLACE FUNCTION public.check_and_reset_daily_limit(user_id uuid)
RETURNS TABLE(words_used integer, daily_limit integer, needs_reset boolean) AS $$
DECLARE
  profile_record RECORD;
  today text;
BEGIN
  today := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD');
  
  SELECT * INTO profile_record 
  FROM public.profiles 
  WHERE id = user_id;
  
  IF profile_record.last_reset_date IS NULL OR profile_record.last_reset_date != today THEN
    -- Reset needed
    UPDATE public.profiles
    SET words_used = 0, last_reset_date = today
    WHERE id = user_id;
    
    RETURN QUERY SELECT 0 as words_used, profile_record.daily_limit, true as needs_reset;
  ELSE
    -- No reset needed
    RETURN QUERY SELECT profile_record.words_used, profile_record.daily_limit, false as needs_reset;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.check_and_reset_daily_limit TO authenticated;

COMMENT ON FUNCTION public.check_and_reset_daily_limit IS 
'Checks if daily reset is needed (server time, UTC) and resets words_used if needed. Returns current usage.';


-- ============================================================
-- 6. Fix daily_limit mismatch (999999 → 1000000 for premium)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_daily_limit(plan text)
RETURNS integer AS $$
BEGIN
  CASE plan
    WHEN 'premium' THEN RETURN 1000000;  -- Fixed: was 999999
    WHEN 'pro' THEN RETURN 20000;
    ELSE RETURN 2000;
  END CASE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.get_daily_limit IS 
'Returns the daily word limit for a given plan type. Premium: 1M, Pro: 20K, Free: 2K.';

-- Update existing premium users to 1000000
UPDATE public.profiles 
SET daily_limit = 1000000 
WHERE plan_type = 'premium' AND daily_limit != 1000000;


-- ============================================================
-- 7. ADD index for performance (auth lookups are frequent)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_profiles_plan_type ON public.profiles(plan_type);
CREATE INDEX IF NOT EXISTS idx_profiles_last_reset ON public.profiles(last_reset_date);

COMMENT ON INDEX idx_profiles_plan_type IS 'Speeds up plan-based queries';
COMMENT ON INDEX idx_profiles_last_reset IS 'Speeds up daily reset checks';
