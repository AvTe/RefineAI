-- RefineAI Database Schema Migration
-- Run this in Supabase SQL Editor to add premium/credit features

-- 1. Add is_premium column if not exists
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT false;

-- 2. Add plan_type column for different subscription tiers
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS plan_type TEXT DEFAULT 'free';

-- 3. Add subscription fields
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS subscription_id TEXT;

-- 4. Add total_words_all_time for lifetime tracking
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS total_words_all_time INTEGER DEFAULT 0;

-- 5. Update the daily_limit based on plan_type
-- Free: 2000, Pro: 20000, Premium: unlimited (999999)

-- Create a function to get daily limit based on plan
CREATE OR REPLACE FUNCTION get_daily_limit(plan TEXT)
RETURNS INTEGER AS $$
BEGIN
  CASE plan
    WHEN 'premium' THEN RETURN 999999;
    WHEN 'pro' THEN RETURN 20000;
    ELSE RETURN 2000;
  END CASE;
END;
$$ LANGUAGE plpgsql;

-- 6. Create trigger to update daily_limit when plan changes
CREATE OR REPLACE FUNCTION update_daily_limit_on_plan_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.plan_type IS DISTINCT FROM OLD.plan_type THEN
    NEW.daily_limit := get_daily_limit(NEW.plan_type);
    IF NEW.plan_type IN ('pro', 'premium') THEN
      NEW.is_premium := true;
    ELSE
      NEW.is_premium := false;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_daily_limit ON profiles;
CREATE TRIGGER trigger_update_daily_limit
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_daily_limit_on_plan_change();

-- 7. Create a function to manually upgrade a user (admin use)
CREATE OR REPLACE FUNCTION upgrade_user_plan(user_id UUID, new_plan TEXT, expires_at TIMESTAMP WITH TIME ZONE DEFAULT NULL)
RETURNS void AS $$
BEGIN
  UPDATE profiles
  SET 
    plan_type = new_plan,
    is_premium = (new_plan IN ('pro', 'premium')),
    daily_limit = get_daily_limit(new_plan),
    subscription_expires_at = expires_at
  WHERE id = user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. Grant execute permissions
GRANT EXECUTE ON FUNCTION upgrade_user_plan TO authenticated;

-- Example usage to upgrade a user:
-- SELECT upgrade_user_plan('user-uuid-here', 'pro', NOW() + INTERVAL '30 days');
