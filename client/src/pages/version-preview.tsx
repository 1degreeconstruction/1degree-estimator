import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Download, Clock } from "lucide-react";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils";
import { PHASE_GROUPS } from "@shared/schema";

function getPhaseLabel(value: string, customLabel?: string | null): string {
  if (value === "other" && customLabel) return customLabel;
  return PHASE_GROUPS.find(p => p.value === value)?.label || value;
}

export default function VersionPreview() {
  const params = useParams<{ id: string; versionNumber: string }>();

  const { data: estimate, isLoading } = useQuery<any>({
    queryKey: ["/api/estimates", params.id, "versions", params.versionNumber],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/estimates/${params.id}/versions/${params.versionNumber}`);
      return res.json();
    },
  });

  const handlePrint = () => {
    window.print();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-background p-8">
        <Skeleton className="h-8 w-64 mb-4" />
        <Skeleton className="h-4 w-48 mb-8" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!estimate) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Version not found</p>
      </div>
    );
  }

  const version = estimate._version;
  const lineItems: any[] = estimate.lineItems || [];
  const milestones: any[] = estimate.milestones || [];
  const discount = estimate.discount;
  const sortedItems = [...lineItems].sort((a: any, b: any) => a.sortOrder - b.sortOrder);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-background print:bg-white">
      {/* Header bar - hidden on print */}
      <div className="no-print bg-background border-b sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href={`/estimates/${params.id}`}>
              <span className="text-sm text-muted-foreground hover:text-foreground cursor-pointer inline-flex items-center gap-1">
                <ArrowLeft className="w-3 h-3" /> Back to Estimate
              </span>
            </Link>
            <Badge variant="outline" className="text-xs">
              <Clock className="w-3 h-3 mr-1" />
              Version {version?.number}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {version?.summary} · {version?.changedBy} · {formatDateTime(version?.changedAt)}
            </span>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={handlePrint}>
              <Download className="w-3 h-3" /> PDF
            </Button>
          </div>
        </div>
      </div>

      {/* Estimate content */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        {/* Version banner */}
        <div className="no-print mb-6 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-center">
          <p className="text-xs text-amber-500 font-medium">
            You are viewing a historical snapshot (v{version?.number}) — this is exactly what was sent to the client
          </p>
        </div>

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="font-display text-xl font-bold">{estimate.estimateNumber}</h1>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-sm text-muted-foreground">
            <p>Date: {formatDate(estimate.createdAt)}</p>
            <p>Valid Until: {formatDate(estimate.validUntil)}</p>
          </div>
        </div>

        {/* Client Info */}
        <Card className="mb-6 bg-white dark:bg-card">
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Prepared For</p>
            <p className="font-semibold text-sm">{estimate.clientName}</p>
            <p className="text-sm text-muted-foreground">
              {estimate.projectAddress}, {estimate.city}, {estimate.state} {estimate.zip}
            </p>
            {estimate.clientEmail && <p className="text-sm text-muted-foreground mt-1">{estimate.clientEmail}</p>}
          </CardContent>
        </Card>

        {/* Scope of Work */}
        <div className="mb-6">
          <h2 className="font-display text-lg font-bold mb-4">Scope of Work</h2>
          <div className="space-y-4">
            {(() => {
              // Group items by phase
              const GROUPED_PHASES = ["mep", "insulation_drywall_paint", "tile_finish_carpentry"];
              const sections: Array<{ label: string; items: any[]; collectivePrice: number | null }> = [];
              const processed = new Set<string>();
              for (const item of sortedItems) {
                if (processed.has(item.phaseGroup)) continue;
                if (GROUPED_PHASES.includes(item.phaseGroup)) {
                  const groupItems = sortedItems.filter((i: any) => i.phaseGroup === item.phaseGroup);
                  sections.push({ label: getPhaseLabel(item.phaseGroup, item.customPhaseLabel), items: groupItems, collectivePrice: groupItems.reduce((s: number, i: any) => s + (i.originalPrice || i.clientPrice), 0) });
                  processed.add(item.phaseGroup);
                } else {
                  sections.push({ label: getPhaseLabel(item.phaseGroup, item.customPhaseLabel), items: [item], collectivePrice: null });
                  processed.add(item.phaseGroup + "-" + item.id);
                }
              }
              return sections.map((section, idx) => {
                const origPrice = section.collectivePrice !== null ? section.collectivePrice : (section.items[0]?.originalPrice || section.items[0]?.clientPrice);
                const discPrice = section.collectivePrice !== null
                  ? section.items.reduce((s: number, i: any) => s + (i.discountedPrice || i.clientPrice), 0)
                  : (section.items[0]?.discountedPrice || section.items[0]?.clientPrice);
                return (
                  <Card key={idx} className="bg-white dark:bg-card overflow-hidden">
                    <div className="flex items-center justify-between p-4 bg-muted/30">
                      <h3 className="font-semibold text-sm">{section.label}</h3>
                      {discount && origPrice !== discPrice ? (
                        <div className="text-right flex items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground line-through">{formatCurrency(origPrice)}</span>
                          <span className="font-mono text-sm font-semibold text-green-600 dark:text-green-400">{formatCurrency(discPrice)}</span>
                          <span className="text-[10px] font-semibold text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-500/15 px-1.5 py-0.5 rounded">{discount.savingsPctLabel}% off</span>
                        </div>
                      ) : (
                        <span className="font-mono text-sm font-semibold">{formatCurrency(origPrice)}</span>
                      )}
                    </div>
                    <CardContent className="pt-3 pb-4">
                      {section.items.map((item: any, itemIdx: number) => (
                        <div key={item.id || itemIdx} className={`${itemIdx > 0 ? "mt-3 pt-3 border-t" : ""}`}>
                          <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                            {item.scopeDescription}
                          </p>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                );
              });
            })()}
          </div>
        </div>

        {/* Summary */}
        <Card className="mb-6 bg-white dark:bg-card">
          <CardContent className="pt-5 space-y-3">
            <h2 className="font-display text-lg font-bold mb-4">Estimate Summary</h2>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-mono">{formatCurrency(sortedItems.reduce((s: number, i: any) => s + (i.clientPrice || 0), 0))}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">3% Unforeseen Conditions Allowance</span>
              <span className="font-mono">{formatCurrency(estimate.allowanceAmount)}</span>
            </div>
            <Separator />
            {discount && (
              <div className="bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 rounded-lg p-3 mb-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Original Price</span>
                  <span className="font-mono line-through text-muted-foreground">{formatCurrency(discount.originalTotal)}</span>
                </div>
                <div className="flex justify-between text-sm font-semibold text-green-700 dark:text-green-400">
                  <span>You Save ({discount.savingsPctLabel}%)</span>
                  <span className="font-mono">-{formatCurrency(discount.totalSavings)}</span>
                </div>
              </div>
            )}
            <div className="flex justify-between font-semibold text-lg">
              <span>Total</span>
              <span className="font-mono text-primary">{formatCurrency(estimate.totalClientPrice)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Deposit Due Upon Acceptance</span>
              <span className="font-mono font-semibold">{formatCurrency(estimate.depositAmount)}</span>
            </div>
          </CardContent>
        </Card>

        {/* Payment Schedule */}
        {milestones.length > 0 && (
          <Card className="mb-6 bg-white dark:bg-card">
            <CardContent className="pt-5">
              <h2 className="font-display text-lg font-bold mb-4">Payment Schedule</h2>
              <div className="space-y-3">
                {milestones.sort((a: any, b: any) => a.sortOrder - b.sortOrder).map((m: any, idx: number) => (
                  <div key={idx} className="flex justify-between text-sm py-2 border-b last:border-0">
                    <span>{m.milestoneName || m.name}</span>
                    <span className="font-mono font-medium">{formatCurrency(m.amount)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
