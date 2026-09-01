import { useState } from "react";
import { Button } from "../ui/Button";
import { Input, Label } from "../ui/Input";
import { supabase, supabaseConfigured } from "../../lib/supabaseClient";

export function LoginForm({ onDemo }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setPending(true);
    try {
      if (!supabaseConfigured) {
        onDemo?.();
        return;
      }
      const { error: err } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (err) throw err;
    } catch (err) {
      setError(err.message || "Sign in failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-4 py-12">
      <img src="/logo.png" alt="Logo" className="mb-6 h-28 w-28 object-contain" />
      <h1 className="text-center text-lg font-semibold text-white">
        Sri Sri Sathya Sai Automobiles
      </h1>
      <p className="mt-1 text-sm text-white-muted">Bike Parts & Service — POS</p>

      <form onSubmit={submit} className="mt-8 w-full max-w-sm space-y-4">
        {error ? (
          <p className="rounded-lg border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
        {!supabaseConfigured ? (
          <p className="text-sm text-warning">
            Supabase not configured. Use demo mode or add VITE_SUPABASE_URL and
            VITE_SUPABASE_ANON_KEY to .env
          </p>
        ) : null}
        <div>
          <Label>Email</Label>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </div>
        <div>
          <Label>Password</Label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </div>
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Signing in…" : "Sign in"}
        </Button>
        {!supabaseConfigured ? (
          <Button type="button" variant="secondary" className="w-full" onClick={onDemo}>
            Continue in demo mode
          </Button>
        ) : null}
      </form>
    </div>
  );
}
