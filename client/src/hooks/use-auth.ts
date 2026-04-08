import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getToken, clearToken } from "@/lib/auth";

const BACKEND_URL = import.meta.env.PROD
  ? "https://onedegree-estimator.onrender.com"
  : "";

export interface AuthUser {
  id: number;
  googleId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: string;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

async function fetchMe(): Promise<AuthUser | null> {
  const token = getToken();
  if (!token) return null;

  const res = await fetch(`${BACKEND_URL}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) return null;
  if (!res.ok) return null;
  return res.json();
}

export function useAuth() {
  const queryClient = useQueryClient();

  const { data: user, isLoading } = useQuery<AuthUser | null>({
    queryKey: ["auth", "me"],
    queryFn: fetchMe,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: false,
  });

  function logout() {
    clearToken();
    queryClient.setQueryData(["auth", "me"], null);
    queryClient.invalidateQueries({ queryKey: ["auth"] });
    window.location.hash = "/login";
  }

  return {
    user: user ?? null,
    isLoading,
    isAuthenticated: !!user && !!getToken(),
    logout,
  };
}
