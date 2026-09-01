const PROFILE_CACHE_KEY = "ssa_cached_profile";

export function isOnline() {
  return typeof navigator !== "undefined" && navigator.onLine;
}

export function cacheAuthProfile(profile) {
  if (!profile) return;
  try {
    localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile));
  } catch {
    /* ignore quota / private mode */
  }
}

export function readCachedAuthProfile(userId) {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return null;
    const profile = JSON.parse(raw);
    return profile?.id === userId ? profile : null;
  } catch {
    return null;
  }
}

export function profileFromSession(user) {
  if (!user) return null;
  const role = user.user_metadata?.role ?? user.app_metadata?.role ?? "staff";
  return {
    id: user.id,
    role,
    email: user.email ?? "",
    full_name:
      user.user_metadata?.full_name ?? user.user_metadata?.name ?? user.email ?? "Staff",
  };
}
