// Initialize Supabase Client
const SUPABASE_URL = 'https://sizvcdcdcrodxyfbqkau.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNpenZjZGNkY3JvZHh5ZmJxa2F1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyNDcwODYsImV4cCI6MjA5NjgyMzA4Nn0.26EVSOXBzn8XfsNYefz1LpUvQkL5p70dKpYDePa3mGI';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

window.supabase = supabaseClient;
