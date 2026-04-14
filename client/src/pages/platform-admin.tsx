import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { AdminLayout } from "@/components/admin-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Building2, Users, Plus, Trash2, ChevronRight, Globe, Phone, Mail, Shield, Settings,
} from "lucide-react";

interface Org {
  id: number; name: string; slug: string; address: string; city: string; state: string;
  zip: string; phone: string; email: string; website: string; license_number: string;
  is_active: boolean; member_count: number; created_at: string;
}

interface Member {
  id: number; user_id: number; role: string; is_active: boolean; name: string; email: string; avatar_url: string;
}

export default function PlatformAdmin() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedOrgId, setSelectedOrgId] = useState<number | null>(null);
  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [newOrg, setNewOrg] = useState({ name: "", slug: "", email: "", phone: "", address: "", city: "", state: "", zip: "", website: "", licenseNumber: "" });
  const [addEmail, setAddEmail] = useState("");
  const [addRole, setAddRole] = useState("estimator");

  const { data: orgs = [] } = useQuery<Org[]>({ queryKey: ["/api/platform/orgs"] });
  const { data: members = [] } = useQuery<Member[]>({
    queryKey: ["/api/platform/orgs", selectedOrgId, "members"],
    enabled: !!selectedOrgId,
  });

  const createOrgMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/platform/orgs", newOrg).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/platform/orgs"] });
      setShowCreateOrg(false);
      setNewOrg({ name: "", slug: "", email: "", phone: "", address: "", city: "", state: "", zip: "", website: "", licenseNumber: "" });
      toast({ title: "Organization created" });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const addMemberMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/platform/orgs/${selectedOrgId}/members`, { email: addEmail, role: addRole }).then(r => { if (!r.ok) throw r; return r.json(); }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/platform/orgs", selectedOrgId, "members"] });
      setAddEmail("");
      toast({ title: "Member added" });
    },
    onError: () => toast({ title: "Failed to add member", variant: "destructive" }),
  });

  const removeMemberMutation = useMutation({
    mutationFn: (userId: number) => apiRequest("DELETE", `/api/platform/orgs/${selectedOrgId}/members/${userId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/platform/orgs", selectedOrgId, "members"] });
      toast({ title: "Member removed" });
    },
  });

  const changeRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: number; role: string }) =>
      apiRequest("PATCH", `/api/platform/orgs/${selectedOrgId}/members/${userId}`, { role }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/platform/orgs", selectedOrgId, "members"] });
      toast({ title: "Role updated" });
    },
  });

  const deleteOrgMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/platform/orgs/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/platform/orgs"] });
      setSelectedOrgId(null);
      toast({ title: "Organization deactivated" });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const selectedOrg = orgs.find(o => o.id === selectedOrgId);

  return (
    <AdminLayout>
      <div className="flex h-[calc(100vh-60px)]">
        {/* Left — org list */}
        <div className="w-80 border-r border-zinc-800 flex flex-col">
          <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-orange-400" />
              <span className="font-semibold text-sm">Platform Admin</span>
            </div>
            <Button size="sm" className="h-7 text-xs gap-1 bg-orange-600 hover:bg-orange-700" onClick={() => setShowCreateOrg(true)}>
              <Plus className="w-3 h-3" /> New Org
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {orgs.map(org => (
              <button
                key={org.id}
                onClick={() => setSelectedOrgId(org.id)}
                className={`w-full text-left px-4 py-3 border-b border-zinc-800/50 hover:bg-zinc-800/40 transition-colors ${
                  selectedOrgId === org.id ? "bg-zinc-800/60" : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <Building2 className="w-4 h-4 text-zinc-500 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{org.name}</div>
                      <div className="text-[11px] text-zinc-500">{org.slug} · {org.member_count} members</div>
                    </div>
                  </div>
                  {!org.is_active && <Badge variant="outline" className="text-[10px] text-red-400 border-red-400/30">Inactive</Badge>}
                  <ChevronRight className="w-3 h-3 text-zinc-600 shrink-0" />
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Right — org detail */}
        <div className="flex-1 overflow-y-auto">
          {showCreateOrg ? (
            <div className="p-6 max-w-2xl">
              <h2 className="text-lg font-semibold mb-4">Create New Organization</h2>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div><Label>Company Name</Label><Input value={newOrg.name} onChange={e => setNewOrg(p => ({ ...p, name: e.target.value }))} placeholder="Acme Construction" /></div>
                <div><Label>Slug (URL-safe)</Label><Input value={newOrg.slug} onChange={e => setNewOrg(p => ({ ...p, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") }))} placeholder="acme" /></div>
                <div><Label>Email</Label><Input value={newOrg.email} onChange={e => setNewOrg(p => ({ ...p, email: e.target.value }))} placeholder="info@acme.com" /></div>
                <div><Label>Phone</Label><Input value={newOrg.phone} onChange={e => setNewOrg(p => ({ ...p, phone: e.target.value }))} /></div>
                <div className="col-span-2"><Label>Address</Label><Input value={newOrg.address} onChange={e => setNewOrg(p => ({ ...p, address: e.target.value }))} /></div>
                <div><Label>City</Label><Input value={newOrg.city} onChange={e => setNewOrg(p => ({ ...p, city: e.target.value }))} /></div>
                <div className="grid grid-cols-2 gap-2"><div><Label>State</Label><Input value={newOrg.state} onChange={e => setNewOrg(p => ({ ...p, state: e.target.value }))} /></div><div><Label>ZIP</Label><Input value={newOrg.zip} onChange={e => setNewOrg(p => ({ ...p, zip: e.target.value }))} /></div></div>
                <div><Label>Website</Label><Input value={newOrg.website} onChange={e => setNewOrg(p => ({ ...p, website: e.target.value }))} /></div>
                <div><Label>License #</Label><Input value={newOrg.licenseNumber} onChange={e => setNewOrg(p => ({ ...p, licenseNumber: e.target.value }))} /></div>
              </div>
              <div className="flex gap-2">
                <Button className="bg-orange-600 hover:bg-orange-700" onClick={() => createOrgMutation.mutate()} disabled={!newOrg.name || !newOrg.slug || createOrgMutation.isPending}>
                  {createOrgMutation.isPending ? "Creating..." : "Create Organization"}
                </Button>
                <Button variant="ghost" onClick={() => setShowCreateOrg(false)}>Cancel</Button>
              </div>
            </div>
          ) : !selectedOrgId ? (
            <div className="flex-1 flex items-center justify-center h-full">
              <div className="text-center text-zinc-600">
                <Building2 className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Select an organization or create a new one</p>
              </div>
            </div>
          ) : selectedOrg ? (
            <div className="p-6 max-w-3xl space-y-6">
              {/* Org header */}
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-xl font-semibold">{selectedOrg.name}</h2>
                  <div className="flex flex-wrap gap-3 text-sm text-zinc-400 mt-1">
                    {selectedOrg.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{selectedOrg.email}</span>}
                    {selectedOrg.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{selectedOrg.phone}</span>}
                    {selectedOrg.website && <span className="flex items-center gap-1"><Globe className="w-3 h-3" />{selectedOrg.website}</span>}
                  </div>
                  {selectedOrg.address && <p className="text-xs text-zinc-500 mt-1">{selectedOrg.address}, {selectedOrg.city} {selectedOrg.state} {selectedOrg.zip}</p>}
                </div>
                {selectedOrg.id !== 1 && (
                  <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300"
                    onClick={() => { if (window.confirm(`Deactivate ${selectedOrg.name}?`)) deleteOrgMutation.mutate(selectedOrg.id); }}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>

              {/* Members */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Users className="w-4 h-4" /> Members ({members.filter(m => m.is_active).length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {/* Add member */}
                  <div className="flex gap-2 mb-4">
                    <Input
                      placeholder="user@email.com"
                      value={addEmail}
                      onChange={e => setAddEmail(e.target.value)}
                      className="flex-1"
                    />
                    <Select value={addRole} onValueChange={setAddRole}>
                      <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="org_admin">Org Admin</SelectItem>
                        <SelectItem value="estimator">Estimator</SelectItem>
                        <SelectItem value="viewer">Viewer</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button size="sm" onClick={() => addMemberMutation.mutate()} disabled={!addEmail.includes("@") || addMemberMutation.isPending} className="gap-1">
                      <Plus className="w-3 h-3" /> Add
                    </Button>
                  </div>

                  {/* Member list */}
                  <div className="space-y-2">
                    {members.filter(m => m.is_active).map(m => (
                      <div key={m.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-900/30">
                        <div>
                          <div className="text-sm font-medium">{m.name}</div>
                          <div className="text-xs text-zinc-500">{m.email}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Select value={m.role} onValueChange={role => changeRoleMutation.mutate({ userId: m.user_id, role })}>
                            <SelectTrigger className="w-28 h-7 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="org_admin">Org Admin</SelectItem>
                              <SelectItem value="estimator">Estimator</SelectItem>
                              <SelectItem value="viewer">Viewer</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-400"
                            onClick={() => { if (window.confirm(`Remove ${m.name}?`)) removeMemberMutation.mutate(m.user_id); }}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : null}
        </div>
      </div>
    </AdminLayout>
  );
}
