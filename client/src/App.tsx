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

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/estimates/new" component={EstimateForm} />
      <Route path="/estimates/:id/edit" component={EstimateForm} />
      <Route path="/estimates/:id" component={EstimateDetail} />
      <Route path="/estimate/:uniqueId" component={ClientEstimate} />
      <Route path="/estimate/:uniqueId/confirmation" component={ClientConfirmation} />
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
