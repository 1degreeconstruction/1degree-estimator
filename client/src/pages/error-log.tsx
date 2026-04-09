import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { AdminLayout } from "@/components/admin-layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Trash2, RefreshCw } from "lucide-react";

interface ErrorEntry {
  id: number;
  route: string;
  method: string;
  status: number;
  error_message: string;
  user_id: number | null;
  created_at: string;
}

function statusColor(s: number) {
  if (s >= 500) return "bg-red-500/15 text-red-400";
  if (s >= 400) return "bg-amber-500/15 text-amber-400";
  return "bg-zinc-500/15 text-zinc-400";
}

function timeAgo(d: string) {
  const m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function ErrorLog() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: errors = [], isLoading, refetch } = useQuery<ErrorEntry[]>({
    queryKey: ["/api/admin/errors"],
  });

  const clearMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/admin/errors"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/errors"] });
      toast({ title: "Error log cleared" });
    },
  });

  return (
    <AdminLayout>
      <div className="p-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            <h1 className="text-lg font-semibold">Error Log</h1>
            <Badge variant="outline" className="text-xs">{errors.length}</Badge>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => refetch()} className="gap-1">
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </Button>
            {errors.length > 0 && (
              <Button size="sm" variant="destructive" onClick={() => clearMutation.mutate()} disabled={clearMutation.isPending} className="gap-1">
                <Trash2 className="w-3.5 h-3.5" /> Clear All
              </Button>
            )}
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-zinc-500">Loading...</p>
        ) : errors.length === 0 ? (
          <div className="text-center py-12 text-zinc-500">
            <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No errors. Everything's running clean.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {errors.map(err => (
              <div key={err.id} className="border border-zinc-800 rounded-lg p-4 hover:bg-zinc-800/30 transition-colors">
                <div className="flex items-center gap-3 mb-2">
                  <Badge className={`${statusColor(err.status)} border-0 text-xs font-mono`}>{err.status}</Badge>
                  <span className="text-xs font-mono text-zinc-400">{err.method}</span>
                  <span className="text-xs font-mono text-zinc-300 truncate flex-1">{err.route}</span>
                  <span className="text-xs text-zinc-600 whitespace-nowrap">{timeAgo(err.created_at)}</span>
                  {err.user_id && <span className="text-xs text-zinc-600">user:{err.user_id}</span>}
                </div>
                <p className="text-sm text-zinc-400 break-words whitespace-pre-wrap leading-relaxed">
                  {err.error_message}
                </p>
                <p className="text-[10px] text-zinc-600 mt-1">
                  {new Date(err.created_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "medium" })}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
