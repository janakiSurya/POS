import { useCallback, useEffect, useState } from "react";
import { supabase, supabaseConfigured } from "../lib/supabaseClient";
import {
  cacheAuthProfile,
  isOnline,
  profileFromSession,
  readCachedAuthProfile,
} from "../lib/network";

export function useAuth() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (uid) => {
    if (!supabase) return null;
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", uid)
      .single();
    if (error) return null;
    return data;
  }, []);

  const resolveProfile = useCallback(
    async (sessionUser) => {
      if (!sessionUser) return null;
      let profileRow = readCachedAuthProfile(sessionUser.id);
      if (isOnline()) {
        try {
          const remote = await loadProfile(sessionUser.id);
          if (remote) {
            profileRow = remote;
            cacheAuthProfile(remote);
          }
        } catch (err) {
          console.warn("Profile fetch failed, using cached profile if available.", err);
        }
      }
      return profileRow ?? profileFromSession(sessionUser);
    },
    [loadProfile],
  );

  useEffect(() => {
    if (!supabaseConfigured || !supabase) {
      setLoading(false);
      return;
    }

    let subscription;

    async function init() {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) throw error;
        const sessionUser = session?.user ?? null;
        if (sessionUser) {
          const p = await resolveProfile(sessionUser);
          setUser(sessionUser);
          setProfile(p);
        } else {
          setUser(null);
          setProfile(null);
        }
      } catch (err) {
        console.error("Auth init failed", err);
        setUser(null);
        setProfile(null);
      } finally {
        setLoading(false);
      }
    }

    init();

    const {
      data: { subscription: sub },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const sessionUser = session?.user ?? null;
      if (sessionUser) {
        const p = await resolveProfile(sessionUser);
        setUser(sessionUser);
        setProfile(p);
      } else {
        setUser(null);
        setProfile(null);
      }
    });
    subscription = sub;

    return () => subscription.unsubscribe();
  }, [resolveProfile]);

  const signIn = async (email, password) => {
    if (!supabase) throw new Error("Supabase not configured.");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  };

  const isOwner = profile?.role === "owner";

  return {
    user,
    profile,
    loading,
    signIn,
    signOut,
    isOwner,
    role: profile?.role ?? null,
    supabaseConfigured,
  };
}
