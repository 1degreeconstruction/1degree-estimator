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
import { useAuth } from "@/hooks/use-auth";
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
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
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
