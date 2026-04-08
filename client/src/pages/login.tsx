import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import logoDark from "@/assets/logo-dark.jpg";

const BACKEND_URL = "https://onedegree-estimator.onrender.com";

export default function Login() {
  const [location] = useLocation();

  // Parse error from query string (hash router format: /?error=pending_approval)
  const searchParams = new URLSearchParams(
    typeof window !== "undefined" ? window.location.search : ""
  );
  const error = searchParams.get("error");

  const handleGoogleLogin = () => {
    window.location.href = `${BACKEND_URL}/auth/google`;
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-8">
        {/* Logo */}
        <div className="flex flex-col items-center gap-4">
          <img
            src={logoDark}
            alt="1 Degree Construction"
            className="h-16 w-auto object-contain"
          />
          <div className="text-center">
            <h1 className="font-display text-2xl font-bold">1 Degree Construction</h1>
            <p className="text-muted-foreground text-sm mt-1">Estimator Portal</p>
          </div>
        </div>

        {/* Error state */}
        {error === "pending_approval" && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 text-sm text-yellow-500">
            <p className="font-semibold mb-1">Account Pending Approval</p>
            <p className="text-yellow-400/80">
              Your account is pending admin approval. Please contact{" "}
              <a
                href="mailto:1degreeconstruction@gmail.com"
                className="underline hover:text-yellow-300 transition-colors"
              >
                1degreeconstruction@gmail.com
              </a>
              .
            </p>
          </div>
        )}

        {/* Sign in card */}
        <div className="bg-card border rounded-xl p-8 space-y-6">
          <div className="text-center">
            <h2 className="font-semibold text-lg">Sign in to your account</h2>
            <p className="text-muted-foreground text-sm mt-1">
              Use your company Google account to continue
            </p>
          </div>

          <Button
            onClick={handleGoogleLogin}
            className="w-full gap-3 h-11"
            variant="outline"
          >
            {/* Google icon */}
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path
                d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"
                fill="#4285F4"
              />
              <path
                d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"
                fill="#34A853"
              />
              <path
                d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z"
                fill="#FBBC05"
              />
              <path
                d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z"
                fill="#EA4335"
              />
            </svg>
            Sign in with Google
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            Access is restricted to authorized team members only.
          </p>
        </div>
      </div>
    </div>
  );
}
