import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { AdminLayout } from "@/components/admin-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import {
  Search, Users, Mail, Phone, MapPin, FileText, ChevronRight, Plus, Trash2, ExternalLink, X
} from "lucide-react";

interface Contact {
  id: number; name: string; email: string | null; phone: string | null;
  address: string | null; city: string | null; state: string | null; zip: string | null;
  notes: string | null; createdAt: string;
}

interface Estimate {
  id: number; estimateNumber: string; projectAddress: string; status: string;
  totalClientPrice: number; createdAt: string;
}

const STATUS_COLOR: Record<string, string> = {
  draft: "bg-zinc-500/15 text-zinc-400",
  sent: "bg-blue-500/15 text-blue-400",
  viewed: "bg-amber-500/15 text-amber-400",
  approved: "bg-green-500/15 text-green-400",
};

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 }).format(n);
}

export default function ClientDirectory() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data: contacts = [], isLoading } = useQuery<Contact[]>({ queryKey: ["/api/contacts"] });

  const { data: detail } = useQuery<{ contact: Contact; estimates: Estimate[] }>({
    queryKey: ["/api/contacts", selectedId],
    enabled: !!selectedId,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/contacts/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/contacts"] });
      setSelectedId(null);
      toast({ title: "Contact deleted" });
    },
  });

  const filtered = search
    ? contacts.filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        (c.email || "").toLowerCase().includes(search.toLowerCase()) ||
        (c.phone || "").includes(search)
      )
    : contacts;

  const selected = detail?.contact;
  const estimates = detail?.estimates || [];

  return (
    <AdminLayout>
      <div className="flex h-[calc(100vh-60px)]">
        {/* Left — contact list */}
        <div className="w-80 border-r border-zinc-800 flex flex-col">
          <div className="px-4 py-3 border-b border-zinc-800">
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-4 h-4 text-zinc-400" />
              <span className="font-semibold text-sm">Clients</span>
              <Badge variant="outline" className="text-xs">{contacts.length}</Badge>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-zinc-500" />
              <Input
                placeholder="Search clients..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="h-8 pl-8 text-xs"
                data-testid="input-search-clients"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 text-sm text-zinc-500">Loading...</div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-sm text-zinc-500 text-center">
                {search ? "No matches." : "No clients yet. Create an estimate to auto-add a client."}
              </div>
            ) : (
              filtered.map(c => (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className={`w-full text-left px-4 py-3 border-b border-zinc-800/50 hover:bg-zinc-800/40 transition-colors ${
                    selectedId === c.id ? "bg-zinc-800/60" : ""
                  }`}
                >
                  <div className="text-sm font-medium text-zinc-200 truncate">{c.name}</div>
                  {c.email && <div className="text-[11px] text-zinc-500 truncate">{c.email}</div>}
                  {c.phone && <div className="text-[11px] text-zinc-600 truncate">{c.phone}</div>}
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right — client detail / folder */}
        <div className="flex-1 flex flex-col overflow-y-auto">
          {!selectedId ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-zinc-600">
                <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Select a client to view their estimates</p>
              </div>
            </div>
          ) : selected ? (
            <div className="p-6">
              {/* Client header */}
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h2 className="text-xl font-semibold mb-1">{selected.name}</h2>
                  <div className="flex flex-wrap gap-4 text-sm text-zinc-400">
                    {selected.email && (
                      <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5" />{selected.email}</span>
                    )}
                    {selected.phone && (
                      <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" />{selected.phone}</span>
                    )}
                    {selected.address && (
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5" />
                        {selected.address}{selected.city ? `, ${selected.city}` : ""}{selected.state ? ` ${selected.state}` : ""} {selected.zip}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Link href={`/estimates/new?client=${selected.id}`}>
                    <Button size="sm" className="gap-1 bg-orange-600 hover:bg-orange-700">
                      <Plus className="w-3.5 h-3.5" /> New Estimate
                    </Button>
                  </Link>
                  <Button
                    size="sm" variant="ghost"
                    className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                    onClick={() => {
                      if (window.confirm(`Delete ${selected.name} from contacts?`)) deleteMutation.mutate(selected.id);
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              {/* Estimates list */}
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-zinc-400 mb-3 flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Estimates ({estimates.length})
                </h3>

                {estimates.length === 0 ? (
                  <p className="text-sm text-zinc-600">No estimates yet for this client.</p>
                ) : (
                  <div className="space-y-2">
                    {estimates.map(est => (
                      <Link key={est.id} href={`/estimates/${est.id}`}>
                        <Card className="cursor-pointer hover:bg-zinc-800/50 transition-colors" data-testid={`card-estimate-${est.id}`}>
                          <CardContent className="p-4 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <FileText className="w-4 h-4 text-zinc-500" />
                              <div>
                                <div className="text-sm font-medium">{est.estimateNumber}</div>
                                <div className="text-xs text-zinc-500">{est.projectAddress}</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-sm font-mono">{formatCurrency(est.totalClientPrice)}</span>
                              <Badge className={`${STATUS_COLOR[est.status] || STATUS_COLOR.draft} border-0 text-xs`}>
                                {est.status}
                              </Badge>
                              <ChevronRight className="w-4 h-4 text-zinc-600" />
                            </div>
                          </CardContent>
                        </Card>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </AdminLayout>
  );
}
