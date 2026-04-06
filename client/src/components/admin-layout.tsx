import { Link, useLocation } from "wouter";
import { useTheme } from "./theme-provider";
import { LayoutDashboard, FileText, Plus, Sun, Moon, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/estimates/new", label: "New Estimate", icon: Plus },
];

function Logo() {
  return (
    <svg viewBox="0 0 40 40" width="32" height="32" fill="none" aria-label="1 Degree Construction" className="shrink-0">
      <rect width="40" height="40" rx="8" className="fill-primary" />
      <text x="10" y="28" fontFamily="var(--font-display)" fontWeight="800" fontSize="22" className="fill-primary-foreground">1°</text>
    </svg>
  );
}

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { theme, setTheme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden" data-testid="admin-layout">
      {/* Mobile header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 bg-sidebar border-b px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Logo />
          <span className="font-display text-sm font-bold">1 Degree</span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setSidebarOpen(!sidebarOpen)} data-testid="button-menu">
          {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </Button>
      </div>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="md:hidden fixed inset-0 bg-black/50 z-40" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`w-60 shrink-0 border-r bg-sidebar flex flex-col fixed md:static inset-y-0 left-0 z-40 transform transition-transform md:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`} data-testid="sidebar">
        <div className="p-4 flex items-center gap-3 border-b">
          <Logo />
          <div className="min-w-0">
            <h1 className="font-display text-sm font-bold leading-tight truncate">1 Degree</h1>
            <p className="text-xs text-muted-foreground">Construction</p>
          </div>
        </div>
        
        <nav className="flex-1 p-3 space-y-1" data-testid="nav">
          {NAV_ITEMS.map(item => {
            const isActive = item.href === "/" ? location === "/" : location.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href}>
                <div
                  onClick={() => setSidebarOpen(false)}
                  className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                  data-testid={`nav-${item.label.toLowerCase().replace(/\s/g, '-')}`}
                >
                  <item.icon className="w-4 h-4" />
                  {item.label}
                </div>
              </Link>
            );
          })}
        </nav>
        
        <div className="p-3 border-t">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-3"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            data-testid="theme-toggle"
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            {theme === "dark" ? "Light Mode" : "Dark Mode"}
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto pt-14 md:pt-0" data-testid="main-content">
        {children}
      </main>
    </div>
  );
}
