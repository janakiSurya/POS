import { useState } from "react";
import { Button } from "../ui/Button";
import { Input, Label } from "../ui/Input";
import { Card } from "../ui/Card";
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
    <div className="flex min-h-full flex-col items-center justify-center bg-paper px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <img
            src="/logo.png"
            alt="Logo"
            className="mx-auto mb-5 h-28 w-28 object-contain sm:h-32 sm:w-32"
          />
          <h1 className="text-xl font-semibold tracking-tight text-ink">
            Sri Sri Sathya Sai Automobiles
          </h1>
          <p className="mt-1 text-sm text-fog">Bike Parts & Service — POS</p>
        </div>

        <Card className="p-6">
          <form onSubmit={submit} className="space-y-4">
            {error ? (
              <p className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
                {error}
              </p>
            ) : null}
            {!supabaseConfigured ? (
              <p className="rounded-lg border border-tangerine/30 bg-tangerine/5 px-3 py-2 text-sm text-tangerine">
                Supabase not configured. Use demo mode or add env keys.
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
        </Card>
      </div>
    </div>
  );
}
