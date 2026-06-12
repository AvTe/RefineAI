// Initialize Supabase Client
const SUPABASE_URL = 'https://yqoyweqarzezcvdcgnzk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlxb3l3ZXFhcnplemN2ZGNnbnprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk2MjI2MTksImV4cCI6MjA4NTE5ODYxOX0.4Z5y5oyh1thfmRgUUBAFkBFmyy4Y_8QED3P_UZDovB8';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

window.supabase = supabaseClient;
