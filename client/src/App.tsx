import { useEffect } from "react";
import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import EstimateForm from "@/pages/estimate-form";
import EstimateDetail from "@/pages/estimate-detail";
import ClientEstimate from "@/pages/client-estimate";
import ClientConfirmation from "@/pages/client-confirmation";
import Login from "@/pages/login";
import AdminUsers from "@/pages/admin-users";
import AuthCallback from "@/pages/auth-callback";
import PricingChat from "@/pages/pricing-chat";
import PurchaseOrders from "@/pages/purchase-orders";
import PricingDashboard from "@/pages/pricing-dashboard";
import TeamInbox from "@/pages/team-inbox";
import TeamChat from "@/pages/team-chat";
import ErrorLog from "@/pages/error-log";
import ClientDirectory from "@/pages/client-directory";
import UsageDashboard from "@/pages/usage-dashboard";
import { useAuth } from "@/hooks/use-auth";
import { setToken } from "@/lib/auth";
import { Skeleton } from "@/components/ui/skeleton";

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="space-y-3 w-64">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login />;
  }

  return <>{children}</>;
}

function AppRouter() {
  return (
    <Switch>
      {/* Auth callback — captures JWT from Google OAuth redirect */}
      <Route path="/auth/callback" component={AuthCallback} />

      {/* Public client-facing routes — no auth required */}
      <Route path="/estimate/:uniqueId" component={ClientEstimate} />
      <Route path="/estimate/:uniqueId/confirmation" component={ClientConfirmation} />

      {/* Protected admin routes */}
      <Route path="/">
        {() => (
          <AuthGuard>
            <Dashboard />
          </AuthGuard>
        )}
      </Route>
      <Route path="/estimates/new">
        {() => (
          <AuthGuard>
            <EstimateForm />
          </AuthGuard>
        )}
      </Route>
      <Route path="/estimates/:id/edit">
        {() => (
          <AuthGuard>
            <EstimateForm />
          </AuthGuard>
        )}
      </Route>
      <Route path="/estimates/:id">
        {() => (
          <AuthGuard>
            <EstimateDetail />
          </AuthGuard>
        )}
      </Route>
      <Route path="/admin/users">
        {() => (
          <AuthGuard>
            <AdminUsers />
          </AuthGuard>
        )}
      </Route>
      <Route path="/pricing">
        {() => (
          <AuthGuard>
            <PricingChat />
          </AuthGuard>
        )}
      </Route>
      <Route path="/purchase-orders">
        {() => (
          <AuthGuard>
            <PurchaseOrders />
          </AuthGuard>
        )}
      </Route>
      <Route path="/pricing-db">
        {() => (
          <AuthGuard>
            <PricingDashboard />
          </AuthGuard>
        )}
      </Route>
      <Route path="/clients">
        {() => (
          <AuthGuard>
            <ClientDirectory />
          </AuthGuard>
        )}
      </Route>
      <Route path="/chat">
        {() => (
          <AuthGuard>
            <TeamChat />
          </AuthGuard>
        )}
      </Route>
      <Route path="/inbox">
        {() => (
          <AuthGuard>
            <TeamInbox />
          </AuthGuard>
        )}
      </Route>
      <Route path="/admin/usage">
        {() => (
          <AuthGuard>
            <UsageDashboard />
          </AuthGuard>
        )}
      </Route>
      <Route path="/admin/errors">
        {() => (
          <AuthGuard>
            <ErrorLog />
          </AuthGuard>
        )}
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  // Capture JWT token from auth callback URL before router mounts
  // URL format: /#/auth/callback?token=<jwt>
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes('/auth/callback') && hash.includes('token=')) {
      const search = hash.split('?')[1] || '';
      const params = new URLSearchParams(search);
      const token = params.get('token');
      if (token) {
        setToken(token);
        // Clean the URL and redirect to dashboard
        window.location.hash = '#/';
      }
    }
  }, []);

  return (
    <ThemeProvider defaultTheme="dark">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Router hook={useHashLocation}>
            <AppRouter />
          </Router>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
// Auth system v1 — Wed Apr  8 02:25:41 UTC 2026
