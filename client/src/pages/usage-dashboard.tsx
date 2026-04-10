import { useQuery } from "@tanstack/react-query";
import { AdminLayout } from "@/components/admin-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  BarChart3, Mail, MessageSquare, FileText, Users, Database,
  AlertTriangle, Zap, Server, Cloud, Activity,
} from "lucide-react";

interface UsageData {
  totals: Record<string, number>;
  today: { gmailSends: number; aiCalls: number };
  limits: Record<string, { daily?: number | string; storage?: string; rows?: string; hours?: string; deploys?: string; label: string }>;
  usageByService: Array<{ service: string; action: string; count: number }>;
  recentErrors: Array<{ id: number; route: string; method: string; status: number; error_message: string; created_at: string }>;
  recentActivity: Array<{ id: number; estimate_id: number; action: string; details: string; timestamp: string }>;
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string | number; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-3">
          <div className="text-zinc-500">{icon}</div>
          <div>
            <div className="text-2xl font-bold font-mono">{value}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
            {sub && <div className="text-[10px] text-zinc-600 mt-0.5">{sub}</div>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function statusColor(s: number) {
  if (s >= 500) return "bg-red-500/15 text-red-400";
  if (s >= 400) return "bg-amber-500/15 text-amber-400";
  return "bg-zinc-500/15 text-zinc-400";
}

function timeAgo(d: string) {
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default function UsageDashboard() {
  const { data, isLoading } = useQuery<UsageData>({ queryKey: ["/api/admin/usage"] });

  if (isLoading || !data) return <AdminLayout><div className="p-6 text-zinc-500">Loading...</div></AdminLayout>;

  const t = data.totals;

  return (
    <AdminLayout>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <div className="flex items-center gap-2 mb-2">
          <BarChart3 className="w-5 h-5 text-zinc-400" />
          <h1 className="text-lg font-semibold">Usage & Logs</h1>
        </div>

        {/* Today's usage */}
        <div>
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Today</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard icon={<Mail className="w-5 h-5" />} label="Emails Sent" value={data.today.gmailSends} sub="500/day limit per user" />
            <StatCard icon={<Zap className="w-5 h-5" />} label="AI Calls" value={data.today.aiCalls} sub="Pay-per-use (Anthropic)" />
            <StatCard icon={<AlertTriangle className="w-5 h-5" />} label="Errors" value={data.recentErrors.filter(e => new Date(e.created_at) > new Date(Date.now() - 86400000)).length} sub="Last 24h" />
            <StatCard icon={<Activity className="w-5 h-5" />} label="Activity Events" value={data.recentActivity.filter(a => new Date(a.timestamp) > new Date(Date.now() - 86400000)).length} sub="Last 24h" />
          </div>
        </div>

        {/* All-time totals */}
        <div>
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">All Time</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <StatCard icon={<FileText className="w-4 h-4" />} label="Estimates" value={t.estimates} />
            <StatCard icon={<Mail className="w-4 h-4" />} label="Emails Sent" value={t.emailsSent} />
            <StatCard icon={<Mail className="w-4 h-4" />} label="Emails Received" value={t.emailsReceived} />
            <StatCard icon={<Users className="w-4 h-4" />} label="Contacts" value={t.contacts} />
            <StatCard icon={<Database className="w-4 h-4" />} label="Pricing Records" value={t.pricingEntries} />
            <StatCard icon={<FileText className="w-4 h-4" />} label="Purchase Orders" value={t.purchaseOrders} />
            <StatCard icon={<MessageSquare className="w-4 h-4" />} label="Chat Messages" value={t.chatMessages} />
            <StatCard icon={<Users className="w-4 h-4" />} label="Team Users" value={t.users} />
            <StatCard icon={<AlertTriangle className="w-4 h-4" />} label="Total Errors" value={t.errors} />
          </div>
        </div>

        {/* Service limits */}
        <div>
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Service Limits</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Object.entries(data.limits).map(([key, svc]) => (
              <Card key={key}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Server className="w-3.5 h-3.5 text-zinc-500" />
                    <span className="text-sm font-medium">{svc.label}</span>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {svc.daily && <Badge variant="outline" className="text-xs font-mono">{svc.daily} {typeof svc.daily === "number" ? "/day" : ""}</Badge>}
                    {svc.storage && <Badge variant="outline" className="text-xs font-mono">{svc.storage} storage</Badge>}
                    {svc.rows && <Badge variant="outline" className="text-xs font-mono">{svc.rows} DB</Badge>}
                    {svc.hours && <Badge variant="outline" className="text-xs font-mono">{svc.hours}</Badge>}
                    {svc.deploys && <Badge variant="outline" className="text-xs font-mono">{svc.deploys}</Badge>}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Two columns: errors + activity */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent errors */}
          <div>
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Recent Errors</h2>
            {data.recentErrors.length === 0 ? (
              <p className="text-sm text-zinc-600">No errors. Clean.</p>
            ) : (
              <div className="space-y-2">
                {data.recentErrors.map(err => (
                  <Card key={err.id}>
                    <CardContent className="p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge className={`${statusColor(err.status)} border-0 text-[10px] font-mono`}>{err.status}</Badge>
                        <span className="text-xs font-mono text-zinc-400 truncate flex-1">{err.method} {err.route}</span>
                        <span className="text-[10px] text-zinc-600">{timeAgo(err.created_at)}</span>
                      </div>
                      <p className="text-xs text-zinc-500 truncate">{err.error_message}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* Recent activity */}
          <div>
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Recent Activity</h2>
            {data.recentActivity.length === 0 ? (
              <p className="text-sm text-zinc-600">No activity yet.</p>
            ) : (
              <div className="space-y-1.5">
                {data.recentActivity.map(act => (
                  <div key={act.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-900/30 text-xs">
                    <Activity className="w-3 h-3 text-zinc-600 flex-shrink-0" />
                    <span className="text-zinc-400 truncate flex-1">{act.details || act.action}</span>
                    {act.estimate_id && <Badge variant="outline" className="text-[10px] shrink-0">#{act.estimate_id}</Badge>}
                    <span className="text-[10px] text-zinc-600 shrink-0">{timeAgo(act.timestamp)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* API usage breakdown */}
        {data.usageByService.length > 0 && (
          <div>
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">API Usage (30 days)</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {data.usageByService.map((u, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-900/30 text-xs">
                  <span className="text-zinc-400">{u.service} / {u.action}</span>
                  <span className="font-mono font-medium">{Number(u.count)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
