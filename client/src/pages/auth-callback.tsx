import { useEffect } from "react";
import { useLocation } from "wouter";
import { setToken } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";

export default function AuthCallback() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  useEffect(() => {
    // Parse token from the URL hash query string
    // URL format: /#/auth/callback?token=<jwt>
    const search = window.location.hash.split("?")[1] || "";
    const params = new URLSearchParams(search);
    const token = params.get("token");

    if (token) {
      setToken(token);
      // Invalidate the auth cache so /auth/me is re-fetched with the new token
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
    }

    // Redirect to dashboard regardless
    setLocation("/");
  }, [setLocation, queryClient]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-muted-foreground text-sm">Signing you in…</p>
    </div>
  );
}
