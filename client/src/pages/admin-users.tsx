import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/admin-layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Check, X, Users } from "lucide-react";
import { format } from "date-fns";

const BACKEND_URL = "https://onedegree-estimator.onrender.com";

interface AppUser {
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

async function fetchUsers(): Promise<AppUser[]> {
  const res = await fetch(`${BACKEND_URL}/api/admin/users`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch users");
  return res.json();
}

export default function AdminUsers() {
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: users, isLoading } = useQuery<AppUser[]>({
    queryKey: ["admin", "users"],
    queryFn: fetchUsers,
  });

  const approveMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${BACKEND_URL}/api/admin/users/${id}/approve`, {
        method: "PATCH",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to approve user");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      toast({ title: "User approved" });
    },
    onError: () => {
      toast({ title: "Failed to approve user", variant: "destructive" });
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${BACKEND_URL}/api/admin/users/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to deactivate user");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      toast({ title: "User deactivated" });
    },
    onError: () => {
      toast({ title: "Failed to deactivate user", variant: "destructive" });
    },
  });

  const roleMutation = useMutation({
    mutationFn: async ({ id, role }: { id: number; role: string }) => {
      const res = await fetch(`${BACKEND_URL}/api/admin/users/${id}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ role }),
      });
      if (!res.ok) throw new Error("Failed to update role");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      toast({ title: "Role updated" });
    },
    onError: () => {
      toast({ title: "Failed to update role", variant: "destructive" });
    },
  });

  const getInitials = (name: string) =>
    name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);

  const pendingUsers = users?.filter(u => !u.isActive) || [];
  const activeUsers = users?.filter(u => u.isActive) || [];

  return (
    <AdminLayout>
      <div className="p-6 max-w-4xl mx-auto space-y-8">
        <div className="flex items-center gap-3">
          <Users className="w-6 h-6 text-primary" />
          <div>
            <h1 className="font-display text-xl font-bold">Team Members</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Manage access and roles for your team
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : (
          <>
            {/* Pending approvals */}
            {pendingUsers.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  Pending Approval ({pendingUsers.length})
                </h2>
                <div className="space-y-2">
                  {pendingUsers.map(user => (
                    <div
                      key={user.id}
                      className="flex items-center gap-4 border border-yellow-500/30 bg-yellow-500/5 rounded-lg p-4"
                    >
                      <Avatar className="h-10 w-10 shrink-0">
                        {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.name} />}
                        <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{user.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Requested {format(new Date(user.createdAt), "MMM d, yyyy")}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 border-green-500/50 text-green-500 hover:bg-green-500/10"
                          onClick={() => approveMutation.mutate(user.id)}
                          disabled={approveMutation.isPending}
                        >
                          <Check className="w-3.5 h-3.5" />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="gap-1.5 text-destructive hover:bg-destructive/10"
                          onClick={() => deactivateMutation.mutate(user.id)}
                          disabled={deactivateMutation.isPending}
                        >
                          <X className="w-3.5 h-3.5" />
                          Deny
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Active users */}
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Active Members ({activeUsers.length})
              </h2>
              <div className="space-y-2">
                {activeUsers.map(user => (
                  <div
                    key={user.id}
                    className="flex items-center gap-4 border rounded-lg p-4"
                  >
                    <Avatar className="h-10 w-10 shrink-0">
                      {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.name} />}
                      <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm truncate">{user.name}</p>
                        {user.id === currentUser?.id && (
                          <Badge variant="outline" className="text-xs py-0">You</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                      {user.lastLoginAt && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Last login {format(new Date(user.lastLoginAt), "MMM d, yyyy")}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Select
                        value={user.role}
                        onValueChange={(role) => roleMutation.mutate({ id: user.id, role })}
                        disabled={user.id === currentUser?.id}
                      >
                        <SelectTrigger className="w-[130px] h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="estimator">Estimator</SelectItem>
                          <SelectItem value="viewer">Viewer</SelectItem>
                        </SelectContent>
                      </Select>
                      {user.id !== currentUser?.id && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:bg-destructive/10 h-8"
                          onClick={() => deactivateMutation.mutate(user.id)}
                          disabled={deactivateMutation.isPending}
                        >
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}
