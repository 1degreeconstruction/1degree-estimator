import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AdminLayout } from "@/components/admin-layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Plus, Search, FileText, MapPin, Calendar, User } from "lucide-react";
import { formatCurrency, formatDate, getStatusColor, getStatusLabel } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import type { Estimate, SalesRep } from "@shared/schema";

interface AuthUser {
  id: number;
  name: string;
  avatarUrl: string | null;
  role: string;
}

type EnrichedEstimate = Estimate & {
  salesRep?: SalesRep;
  createdByUser?: AuthUser;
};

export default function Dashboard() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [estimateScope, setEstimateScope] = useState<"all" | "mine">("all");
  const { user } = useAuth();

  const { data: estimates, isLoading } = useQuery<EnrichedEstimate[]>({
    queryKey: estimateScope === "mine" ? ["/api/estimates?mine=true"] : ["/api/estimates"],
    queryFn: async () => {
      const url = estimateScope === "mine" ? "/api/estimates?mine=true" : "/api/estimates";
      const res = await apiRequest("GET", url);
      return res.json();
    },
  });

  const filtered = estimates?.filter(e => {
    if (statusFilter !== "all" && e.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        e.clientName.toLowerCase().includes(q) ||
        e.projectAddress.toLowerCase().includes(q) ||
        e.estimateNumber.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const getInitials = (name: string) =>
    name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);

  return (
    <AdminLayout>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between" data-testid="dashboard-header">
          <div>
            <h1 className="font-display text-xl font-bold" data-testid="page-title">Estimates</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {estimates?.length || 0} {estimateScope === "mine" ? "of your" : "total"} estimates
            </p>
          </div>
          <Link href="/estimates/new">
            <Button className="gap-2" data-testid="button-new-estimate">
              <Plus className="w-4 h-4" />
              New Estimate
            </Button>
          </Link>
        </div>

        {/* Scope tabs — My Estimates / All Estimates */}
        <div className="flex items-center gap-1 p-1 bg-muted rounded-lg w-fit">
          <button
            onClick={() => setEstimateScope("mine")}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              estimateScope === "mine"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            My Estimates
          </button>
          <button
            onClick={() => setEstimateScope("all")}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              estimateScope === "all"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            All Estimates
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3" data-testid="filters">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search client, address, or estimate #..."
              className="pl-9"
              value={search}
              onChange={e => setSearch(e.target.value)}
              data-testid="input-search"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px]" data-testid="select-status-filter">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="sent">Sent</SelectItem>
              <SelectItem value="viewed">Viewed</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
              <SelectItem value="declined">Declined</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Estimate List */}
        {isLoading ? (
          <div className="space-y-3" data-testid="loading-skeleton">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
        ) : !filtered?.length ? (
          <div className="text-center py-16 text-muted-foreground" data-testid="empty-state">
            <FileText className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <h3 className="font-medium text-foreground mb-1">No estimates found</h3>
            <p className="text-sm">
              {search || statusFilter !== "all"
                ? "Try adjusting your filters"
                : estimateScope === "mine"
                ? "You haven't created any estimates yet"
                : "Create your first estimate to get started"}
            </p>
          </div>
        ) : (
          <div className="space-y-6" data-testid="estimate-list">
            {(() => {
              // Group by day
              const groups: Record<string, typeof filtered> = {};
              for (const est of filtered) {
                const d = new Date(est.createdAt);
                const today = new Date();
                const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
                let label: string;
                if (d.toDateString() === today.toDateString()) label = "Today";
                else if (d.toDateString() === yesterday.toDateString()) label = "Yesterday";
                else label = d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
                if (!groups[label]) groups[label] = [];
                groups[label].push(est);
              }
              return Object.entries(groups).map(([day, ests]) => (
                <div key={day}>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1">{day}</h3>
                  <div className="space-y-2">
                    {ests.map(estimate => (
              <Link key={estimate.id} href={`/estimates/${estimate.id}`}>
                <div
                  className="border rounded-lg p-4 hover:bg-muted/50 transition-colors cursor-pointer group"
                  data-testid={`estimate-card-${estimate.id}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-3 mb-1">
                        <span className="font-mono text-xs text-muted-foreground" data-testid={`text-estimate-number-${estimate.id}`}>
                          {estimate.estimateNumber}
                        </span>
                        <Badge variant="secondary" className={`text-xs ${getStatusColor(estimate.status)}`} data-testid={`badge-status-${estimate.id}`}>
                          {getStatusLabel(estimate.status)}
                        </Badge>
                      </div>
                      <h3 className="font-semibold text-sm truncate group-hover:text-primary transition-colors" data-testid={`text-client-${estimate.id}`}>
                        {estimate.clientName}
                      </h3>
                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {estimate.projectAddress}, {estimate.city}
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {formatDate(estimate.createdAt)}
                        </span>
                        {estimate.salesRep && (
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {estimate.salesRep.name}
                          </span>
                        )}
                        {estimateScope === "all" && estimate.createdByUser && estimate.createdByUser.id !== user?.id && (
                          <span className="flex items-center gap-1.5">
                            <Avatar className="h-4 w-4">
                              {estimate.createdByUser.avatarUrl && (
                                <AvatarImage src={estimate.createdByUser.avatarUrl} />
                              )}
                              <AvatarFallback className="text-[8px]">
                                {getInitials(estimate.createdByUser.name)}
                              </AvatarFallback>
                            </Avatar>
                            <span>{estimate.createdByUser.name}</span>
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-semibold text-sm" data-testid={`text-total-${estimate.id}`}>
                        {formatCurrency(estimate.totalClientPrice)}
                      </p>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
                  </div>
                </div>
              ));
            })()}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
