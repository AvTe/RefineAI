import urllib.request
import json

url = "https://sizvcdcdcrodxyfbqkau.supabase.co/auth/v1/settings"
anon_key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNpenZjZGNkY3JvZHh5ZmJxa2F1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyNDcwODYsImV4cCI6MjA5NjgyMzA4Nn0.26EVSOXBzn8XfsNYefz1LpUvQkL5p70dKpYDePa3mGI"

headers = {
    "apikey": anon_key
}

req = urllib.request.Request(url, headers=headers)
try:
    with urllib.request.urlopen(req) as response:
        res = json.loads(response.read().decode("utf-8"))
        autoconfirm = res.get("mailer_autoconfirm", False)
        print("\n==================================================")
        print("Supabase Auth Configuration Check:")
        print(f"Project Reference: sizvcdcdcrodxyfbqkau")
        print(f"Mailer Autoconfirm (Confirm email is disabled): {autoconfirm}")
        print("==================================================")
        if not autoconfirm:
            print("[X] Confirm email is still ENABLED in your Supabase Dashboard.")
            print("Please toggle 'Confirm email' to OFF and click 'Save'.")
        else:
            print("[OK] Confirm email is successfully DISABLED!")
            print("You can now sign up test users instantly without hitting rate limits.")
        print("==================================================\n")
except Exception as e:
    print("Error checking settings:", e)
