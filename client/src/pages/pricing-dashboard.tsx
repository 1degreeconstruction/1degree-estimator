import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/admin-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Search, ChevronDown, ChevronRight, Lock, Unlock, Save, Database,
  AlertTriangle, X, FileSpreadsheet, Filter
} from "lucide-react";
import { Link } from "wouter";

// ─── Types ───────────────────────────────────────────────────────────────────

interface PricingEntry {
  id: number;
  trade: string;
  scopeKeyword: string;
  subCost: number;
  clientPrice: number | null;
  markupRate: number | null;
  city: string | null;
  source: string;
  estimateId: number | null;
  salesRepId: number | null;
  createdAt: string;
}

interface TradeGroup {
  trade: string;
  cslb: { code: string; name: string };
  count: number;
  entries: PricingEntry[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CHALLENGE_PHRASE = "are you omri?";
const EDIT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

const SOURCE_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  excel_budget_sheet: { bg: "bg-teal-500/15", text: "text-teal-400", label: "Excel Budget" },
  user_edit:       { bg: "bg-blue-500/15", text: "text-blue-400", label: "User Edit" },
  ai_generated:    { bg: "bg-purple-500/15", text: "text-purple-400", label: "AI Generated" },
  purchase_order:  { bg: "bg-green-500/15", text: "text-green-400", label: "Purchase Order" },
  manual_update:   { bg: "bg-amber-500/15", text: "text-amber-400", label: "Manual Update" },
  breakdown_manual: { bg: "bg-zinc-500/15", text: "text-zinc-400", label: "Breakdown Manual" },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCurrency(n: number): string {
  // Show decimals for small values (per-unit rates like $0.50/sqft)
  const hasDecimals = n < 10 && n % 1 !== 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: hasDecimals ? 2 : 0
  }).format(n);
}

function formatDate(s: string): string {
  try {
    return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return s;
  }
}

function getStaleness(dateStr: string): { label: string; color: string; stale: boolean } {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const months = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
    if (months >= 12) return { label: `${months}mo — refresh urgently`, color: "text-red-400", stale: true };
    if (months >= 6) return { label: `${months}mo — needs refresh`, color: "text-amber-400", stale: true };
    if (months >= 3) return { label: `${months}mo`, color: "text-zinc-500", stale: false };
    return { label: "Current", color: "text-green-500", stale: false };
  } catch {
    return { label: "Unknown", color: "text-zinc-500", stale: false };
  }
}

function avgCost(entries: PricingEntry[]): number {
  if (!entries.length) return 0;
  return entries.reduce((s, e) => s + e.subCost, 0) / entries.length;
}

// ─── Source Badge ─────────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: string }) {
  const cfg = SOURCE_COLORS[source] || { bg: "bg-zinc-500/15", text: "text-zinc-400", label: source };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cfg.bg} ${cfg.text}`}>
      {cfg.label}
    </span>
  );
}

// ─── CSLB Code Badge ──────────────────────────────────────────────────────────

function CslbBadge({ code }: { code: string }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded font-mono text-xs font-semibold bg-zinc-800 text-zinc-300 border border-zinc-700">
      {code}
    </span>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────

interface RowProps {
  entry: PricingEntry;
  editMode: boolean;
  onSaved: (id: number, newCost: number) => void;
}

function PricingRow({ entry, editMode, onSaved }: RowProps) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(entry.subCost));
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (newCost: number) => {
      const res = await apiRequest("PATCH", `/api/pricing-dashboard/${entry.id}`, { subCost: newCost });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Saved", description: `Updated to ${formatCurrency(data.subCost)}` });
      setEditing(false);
      onSaved(entry.id, data.subCost);
      queryClient.invalidateQueries({ queryKey: ["/api/pricing-dashboard"] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleSave = () => {
    const parsed = parseFloat(value.replace(/[^0-9.]/g, ""));
    if (isNaN(parsed) || parsed < 0) {
      toast({ title: "Invalid value", variant: "destructive" });
      return;
    }
    mutation.mutate(parsed);
  };

  return (
    <tr className="border-b border-zinc-800/60 hover:bg-zinc-800/30 transition-colors">
      <td className="px-4 py-2.5 text-sm text-zinc-300">{entry.scopeKeyword}</td>
      <td className="px-4 py-2.5 text-sm font-mono">
        {editMode && editing ? (
          <Input
            className="h-7 w-28 text-sm font-mono bg-zinc-900 border-zinc-600"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setEditing(false); }}
            autoFocus
          />
        ) : (
          <span
            className={editMode ? "cursor-pointer underline decoration-dotted underline-offset-2 text-amber-300 hover:text-amber-200" : "text-green-400"}
            onClick={() => { if (editMode) { setValue(String(entry.subCost)); setEditing(true); } }}
          >
            {formatCurrency(entry.subCost)}
          </span>
        )}
      </td>
      <td className="px-4 py-2.5 text-sm font-mono text-zinc-400">
        {entry.clientPrice != null ? formatCurrency(entry.clientPrice) : <span className="text-zinc-600">—</span>}
      </td>
      <td className="px-4 py-2.5 text-sm font-mono text-zinc-400">
        {entry.markupRate != null ? `${entry.markupRate}%` : <span className="text-zinc-600">—</span>}
      </td>
      <td className="px-4 py-2.5 text-sm text-zinc-400">{entry.city || "—"}</td>
      <td className="px-4 py-2.5"><SourceBadge source={entry.source} /></td>
      <td className="px-4 py-2.5 text-xs">
        <div>{formatDate(entry.createdAt)}</div>
        <div className={`text-[10px] font-medium ${getStaleness(entry.createdAt).color}`}>
          {getStaleness(entry.createdAt).stale && "⚠ "}{getStaleness(entry.createdAt).label}
        </div>
      </td>
      <td className="px-4 py-2.5 text-sm text-zinc-400">
        {entry.estimateId ? (
          <Link href={`/estimates/${entry.estimateId}`}>
            <span className="text-blue-400 hover:text-blue-300 underline cursor-pointer">#{entry.estimateId}</span>
          </Link>
        ) : "—"}
      </td>
      {editMode && (
        <td className="px-4 py-2.5">
          {editing ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-green-400 hover:text-green-300"
              onClick={handleSave}
              disabled={mutation.isPending}
            >
              <Save className="w-3.5 h-3.5" />
            </Button>
          ) : (
            <div className="w-7" />
          )}
        </td>
      )}
    </tr>
  );
}

// ─── Trade Section ────────────────────────────────────────────────────────────

interface TradeSectionProps {
  group: TradeGroup;
  editMode: boolean;
  searchQuery: string;
  defaultOpen: boolean;
}

function TradeSection({ group, editMode, searchQuery, defaultOpen }: TradeSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [entries, setEntries] = useState(group.entries);

  // Sync if group changes
  useEffect(() => { setEntries(group.entries); }, [group.entries]);

  const handleSaved = useCallback((id: number, newCost: number) => {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, subCost: newCost } : e));
  }, []);

  const avg = avgCost(entries);
  const staleCount = entries.filter(e => getStaleness(e.createdAt).stale).length;

  return (
    <div className={`border rounded-lg overflow-hidden mb-3 ${staleCount > 0 ? 'border-amber-500/30' : 'border-zinc-800'}`}>
      <button
        className="w-full flex items-center gap-3 px-4 py-3 bg-zinc-900 hover:bg-zinc-800/80 transition-colors text-left"
        onClick={() => setOpen(o => !o)}
      >
        <CslbBadge code={group.cslb.code} />
        <span className="font-semibold text-zinc-100 flex-1">{group.cslb.name}</span>
        <span className="text-xs text-zinc-500">{group.count} entries</span>
        <span className="text-xs text-green-400 font-mono ml-4">avg {formatCurrency(avg)}</span>
        {staleCount > 0 && <span className="text-[10px] text-amber-400 font-medium ml-2">⚠ {staleCount} stale</span>}
        {open ? <ChevronDown className="w-4 h-4 text-zinc-500 ml-2" /> : <ChevronRight className="w-4 h-4 text-zinc-500 ml-2" />}
      </button>

      {open && (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-950">
                <th className="px-4 py-2 text-xs text-zinc-500 font-medium">Scope</th>
                <th className="px-4 py-2 text-xs text-zinc-500 font-medium">Sub Cost</th>
                <th className="px-4 py-2 text-xs text-zinc-500 font-medium">Client Price</th>
                <th className="px-4 py-2 text-xs text-zinc-500 font-medium">Markup</th>
                <th className="px-4 py-2 text-xs text-zinc-500 font-medium">City</th>
                <th className="px-4 py-2 text-xs text-zinc-500 font-medium">Source</th>
                <th className="px-4 py-2 text-xs text-zinc-500 font-medium">Date</th>
                <th className="px-4 py-2 text-xs text-zinc-500 font-medium">Est #</th>
                {editMode && <th className="px-4 py-2 text-xs text-zinc-500 font-medium w-10" />}
              </tr>
            </thead>
            <tbody>
              {entries.map(entry => (
                <PricingRow key={entry.id} entry={entry} editMode={editMode} onSaved={handleSaved} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Challenge Modal ──────────────────────────────────────────────────────────

interface ChallengeModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

function ChallengeModal({ open, onClose, onSuccess }: ChallengeModalProps) {
  const [value, setValue] = useState("");
  const [shake, setShake] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) { setValue(""); setTimeout(() => inputRef.current?.focus(), 100); }
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim().toLowerCase() === CHALLENGE_PHRASE) {
      onSuccess();
      setValue("");
    } else {
      setShake(true);
      setTimeout(() => setShake(false), 600);
      setValue("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm bg-zinc-900 border-zinc-700">
        <DialogHeader>
          <DialogTitle className="text-zinc-100">Enable Edit Mode</DialogTitle>
          <DialogDescription className="text-zinc-400">
            To enable editing, type the phrase below exactly:
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <p className="text-center text-lg font-semibold text-amber-400">"Are you Omri?"</p>
          <div className={shake ? "animate-shake" : ""}>
            <Input
              ref={inputRef}
              placeholder="Type the phrase above..."
              value={value}
              onChange={e => setValue(e.target.value)}
              className="bg-zinc-800 border-zinc-600 text-zinc-100 placeholder:text-zinc-500"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="ghost" onClick={onClose} className="text-zinc-400">Cancel</Button>
            <Button type="submit" className="bg-amber-600 hover:bg-amber-500 text-white">Unlock</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PricingDashboard() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [challengeOpen, setChallengeOpen] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data, isLoading, isError } = useQuery<TradeGroup[]>({
    queryKey: ["/api/pricing-dashboard"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/pricing-dashboard");
      return res.json();
    },
  });

  // ── Auto-lock after 5 min inactivity ──────────────────────────────────────
  const resetTimer = useCallback(() => {
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    inactivityTimer.current = setTimeout(() => {
      setEditMode(false);
      toast({ title: "Edit mode locked", description: "Locked after 5 minutes of inactivity." });
    }, EDIT_TIMEOUT_MS);
  }, [toast]);

  useEffect(() => {
    if (!editMode) {
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
      return;
    }
    resetTimer();
    const events = ["mousemove", "keydown", "click", "scroll"];
    events.forEach(e => window.addEventListener(e, resetTimer));
    return () => {
      events.forEach(e => window.removeEventListener(e, resetTimer));
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    };
  }, [editMode, resetTimer]);

  // ── Source counts ──────────────────────────────────────────────────────────
  const sourceCounts = useMemo(() => {
    if (!data) return {} as Record<string, number>;
    const counts: Record<string, number> = {};
    for (const group of data) {
      for (const entry of group.entries) {
        counts[entry.source] = (counts[entry.source] || 0) + 1;
      }
    }
    return counts;
  }, [data]);

  // ── Search + source filter ────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data
      .map(group => {
        let entries = group.entries;

        // Source filter
        if (sourceFilter) {
          entries = entries.filter(e => e.source === sourceFilter);
        }

        // Text search
        if (q) {
          const tradeMatch =
            group.trade.toLowerCase().includes(q) ||
            group.cslb.code.toLowerCase().includes(q) ||
            group.cslb.name.toLowerCase().includes(q);

          entries = entries.filter(e =>
            e.scopeKeyword.toLowerCase().includes(q) ||
            (e.city || "").toLowerCase().includes(q) ||
            (e.source || "").toLowerCase().includes(q) ||
            tradeMatch
          );
        }

        if (!entries.length) return null;
        return { ...group, entries, count: entries.length };
      })
      .filter(Boolean) as TradeGroup[];
  }, [data, search, sourceFilter]);

  const totalEntries = data?.reduce((s, g) => s + g.entries.length, 0) ?? 0;
  const totalTrades = data?.length ?? 0;
  const filteredEntries = filtered.reduce((s, g) => s + g.entries.length, 0);

  return (
    <AdminLayout>
      <div className="p-6 max-w-7xl mx-auto">
        {/* Edit mode banner */}
        {editMode && (
          <div className="mb-4 flex items-center gap-3 px-4 py-2.5 bg-red-950/60 border border-red-700/60 rounded-lg text-red-300 text-sm font-medium">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            EDIT MODE ACTIVE — changes affect future AI estimates
            <button
              className="ml-auto text-red-400 hover:text-red-300"
              onClick={() => setEditMode(false)}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Database className="w-5 h-5 text-zinc-400" />
              <h1 className="text-xl font-bold text-zinc-100">Pricing Database</h1>
            </div>
            <p className="text-sm text-zinc-500">
              {totalTrades} trade{totalTrades !== 1 ? "s" : ""} · {totalEntries} entries (most recent per scope)
            </p>
          </div>

          {/* Edit Mode Toggle */}
          <button
            onClick={() => {
              if (editMode) {
                setEditMode(false);
              } else {
                setChallengeOpen(true);
              }
            }}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
              editMode
                ? "border-amber-600 bg-amber-600/10 text-amber-400 hover:bg-amber-600/20"
                : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300"
            }`}
          >
            {editMode ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
            {editMode ? "Edit Mode ON" : "Edit Mode OFF"}
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
          <Input
            placeholder="Search by trade, scope, city, or source..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 bg-zinc-900 border-zinc-700 text-zinc-200 placeholder:text-zinc-500 focus:border-zinc-500"
          />
          {search && (
            <button
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
              onClick={() => setSearch("")}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Source filter chips */}
        {!isLoading && totalEntries > 0 && Object.keys(sourceCounts).length > 1 && (
          <div className="flex flex-wrap items-center gap-2 mb-5">
            <Filter className="w-3.5 h-3.5 text-zinc-500" />
            <button
              onClick={() => setSourceFilter(null)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                !sourceFilter
                  ? "bg-zinc-100 text-zinc-900"
                  : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300"
              }`}
            >
              All ({totalEntries})
            </button>
            {Object.entries(sourceCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([src, count]) => {
                const cfg = SOURCE_COLORS[src] || { bg: "bg-zinc-500/15", text: "text-zinc-400", label: src };
                const active = sourceFilter === src;
                return (
                  <button
                    key={src}
                    onClick={() => setSourceFilter(active ? null : src)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                      active
                        ? `${cfg.bg} ${cfg.text} ring-1 ring-current`
                        : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300"
                    }`}
                  >
                    {cfg.label} ({count})
                  </button>
                );
              })}
          </div>
        )}

        {/* Filtered count indicator */}
        {(sourceFilter || search) && !isLoading && (
          <div className="flex items-center gap-2 mb-4 text-xs text-zinc-500">
            Showing {filteredEntries} of {totalEntries} entries across {filtered.length} trade{filtered.length !== 1 ? "s" : ""}
            {(sourceFilter || search) && (
              <button
                onClick={() => { setSourceFilter(null); setSearch(""); }}
                className="text-zinc-400 hover:text-zinc-200 underline"
              >
                Clear filters
              </button>
            )}
          </div>
        )}

        {/* Content */}
        {isLoading && (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg bg-zinc-800" />
            ))}
          </div>
        )}

        {isError && (
          <div className="flex items-center gap-3 p-4 bg-red-950/40 border border-red-800/60 rounded-lg text-red-300 text-sm">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Failed to load pricing data. Please refresh the page.
          </div>
        )}

        {!isLoading && !isError && filtered.length === 0 && (
          <div className="text-center py-16 text-zinc-500">
            {search ? "No results match your search." : "No pricing data found."}
          </div>
        )}

        {!isLoading && !isError && filtered.map(group => (
          <TradeSection
            key={group.trade}
            group={group}
            editMode={editMode}
            searchQuery={search}
            defaultOpen={filtered.length <= 3 || !!search}
          />
        ))}
      </div>

      {/* Challenge Modal */}
      <ChallengeModal
        open={challengeOpen}
        onClose={() => setChallengeOpen(false)}
        onSuccess={() => {
          setChallengeOpen(false);
          setEditMode(true);
          toast({ title: "Edit mode enabled", description: "You can now edit pricing values." });
        }}
      />
    </AdminLayout>
  );
}
