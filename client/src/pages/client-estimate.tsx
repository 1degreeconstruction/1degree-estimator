import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger
} from "@/components/ui/collapsible";
import { AlertCircle, Phone, Mail, ChevronDown, CheckCircle2 } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { PHASE_GROUPS, GROUPED_PHASES } from "@shared/schema";
import type { Estimate, SalesRep, PaymentMilestone } from "@shared/schema";
import { useState, useEffect } from "react";
import { useForceLightMode } from "@/components/theme-provider";

type ClientLineItem = {
  id: number;
  estimateId: number;
  sortOrder: number;
  phaseGroup: string;
  scopeDescription: string;
  clientPrice: number;
  isGrouped: boolean;
};

type ClientEstimate = Omit<Estimate, "totalSubCost"> & {
  salesRep?: SalesRep;
  lineItems: ClientLineItem[];
  milestones: PaymentMilestone[];
};

function getPhaseLabel(value: string): string {
  return PHASE_GROUPS.find(p => p.value === value)?.label || value;
}

function Logo() {
  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 40 40" width="40" height="40" fill="none" aria-label="1 Degree Construction">
        <rect width="40" height="40" rx="8" fill="#E8960A" />
        <text x="10" y="28" fontFamily="'Cabinet Grotesk', sans-serif" fontWeight="800" fontSize="22" fill="#fff">1°</text>
      </svg>
      <div>
        <h1 className="font-display text-lg font-bold text-foreground leading-tight">1 Degree Construction</h1>
      </div>
    </div>
  );
}

export default function ClientEstimate() {
  const params = useParams<{ uniqueId: string }>();
  const [, navigate] = useLocation();
  const [accepted, setAccepted] = useState(false);
  const [signatureName, setSignatureName] = useState("");

  // Force light mode for client pages
  useForceLightMode();

  const { data: estimate, isLoading, error } = useQuery<ClientEstimate>({
    queryKey: ["/api/estimates/public", params.uniqueId],
  });

  const signMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/estimates/public/${params.uniqueId}/sign`, { signatureName });
      return res.json();
    },
    onSuccess: () => {
      navigate(`/estimate/${params.uniqueId}/confirmation`);
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white dark:bg-background">
        <div className="max-w-3xl mx-auto px-6 py-12 space-y-6">
          <Skeleton className="h-12 w-64" />
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  if (error || !estimate) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold mb-2">Estimate Not Found</h2>
          <p className="text-muted-foreground">This estimate link may have expired or is invalid.</p>
        </div>
      </div>
    );
  }

  const isApproved = estimate.status === "approved";
  const isExpired = new Date(estimate.validUntil) < new Date();

  // Group line items for display
  const sortedItems = [...estimate.lineItems].sort((a, b) => a.sortOrder - b.sortOrder);

  // Build display groups: grouped phases show collective price, individual scope
  const displaySections: Array<{
    label: string;
    items: ClientLineItem[];
    collectivePrice: number | null;
  }> = [];

  const processedPhases = new Set<string>();
  for (const item of sortedItems) {
    if (processedPhases.has(item.phaseGroup)) continue;

    if (GROUPED_PHASES.includes(item.phaseGroup)) {
      const groupItems = sortedItems.filter(i => i.phaseGroup === item.phaseGroup);
      const totalPrice = groupItems.reduce((sum, i) => sum + i.clientPrice, 0);
      displaySections.push({
        label: getPhaseLabel(item.phaseGroup),
        items: groupItems,
        collectivePrice: totalPrice,
      });
      processedPhases.add(item.phaseGroup);
    } else {
      displaySections.push({
        label: getPhaseLabel(item.phaseGroup),
        items: [item],
        collectivePrice: null,
      });
      processedPhases.add(item.phaseGroup + "-" + item.id);
    }
  }

  // Recalculate subtotal from visible client prices
  const subtotal = sortedItems.reduce((sum, i) => sum + i.clientPrice, 0);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-background" data-testid="client-estimate-page">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        {/* Header */}
        <div className="mb-8" data-testid="client-header">
          <Logo />
          <div className="mt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Estimate</p>
              <p className="font-mono text-sm" data-testid="text-estimate-number">{estimate.estimateNumber}</p>
            </div>
            <div className="text-sm text-muted-foreground text-right">
              <p>Date: {formatDate(estimate.createdAt)}</p>
              <p>Valid Until: {formatDate(estimate.validUntil)}</p>
            </div>
          </div>
        </div>

        {/* Sales Rep */}
        {estimate.salesRep && (
          <Card className="mb-6 bg-white dark:bg-card" data-testid="card-sales-rep">
            <CardContent className="pt-5">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Your Contact</p>
              <p className="font-semibold text-sm">{estimate.salesRep.name}</p>
              <p className="text-sm text-muted-foreground">{estimate.salesRep.title}</p>
              <div className="flex gap-4 mt-2 text-sm">
                <a href={`mailto:${estimate.salesRep.email}`} className="flex items-center gap-1 text-primary hover:underline">
                  <Mail className="w-3 h-3" /> {estimate.salesRep.email}
                </a>
                <a href={`tel:${estimate.salesRep.phone}`} className="flex items-center gap-1 text-primary hover:underline">
                  <Phone className="w-3 h-3" /> {estimate.salesRep.phone}
                </a>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Client Info */}
        <Card className="mb-6 bg-white dark:bg-card" data-testid="card-client-info">
          <CardContent className="pt-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Prepared For</p>
            <p className="font-semibold text-sm" data-testid="text-client-name">{estimate.clientName}</p>
            <p className="text-sm text-muted-foreground">
              {estimate.projectAddress}, {estimate.city}, {estimate.state} {estimate.zip}
            </p>
          </CardContent>
        </Card>

        {/* Scope of Work */}
        <div className="mb-6" data-testid="scope-of-work">
          <h2 className="font-display text-lg font-bold mb-4">Scope of Work</h2>
          <div className="space-y-4">
            {displaySections.map((section, idx) => (
              <Card key={idx} className="bg-white dark:bg-card overflow-hidden" data-testid={`scope-section-${idx}`}>
                <div className="flex items-center justify-between p-4 bg-muted/30">
                  <h3 className="font-semibold text-sm">{section.label}</h3>
                  {section.collectivePrice !== null ? (
                    <span className="font-mono text-sm font-semibold">{formatCurrency(section.collectivePrice)}</span>
                  ) : (
                    <span className="font-mono text-sm font-semibold">{formatCurrency(section.items[0].clientPrice)}</span>
                  )}
                </div>
                <CardContent className="pt-3 pb-4">
                  {section.items.map((item, itemIdx) => (
                    <div key={item.id} className={`${itemIdx > 0 ? "mt-3 pt-3 border-t" : ""}`}>
                      {section.items.length > 1 && (
                        <p className="text-xs text-muted-foreground font-medium mb-1 uppercase tracking-wider">
                          {/* Show trade label for individual items within a group */}
                          {item.scopeDescription.split("\n")[0]?.length < 50 ? "" : ""}
                        </p>
                      )}
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                        {item.scopeDescription}
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Summary */}
        <Card className="mb-6 bg-white dark:bg-card" data-testid="card-summary">
          <CardContent className="pt-5 space-y-3">
            <h2 className="font-display text-lg font-bold mb-4">Estimate Summary</h2>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-mono" data-testid="text-subtotal">{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <div>
                <span className="text-muted-foreground">3% Unforeseen Conditions Allowance</span>
              </div>
              <span className="font-mono" data-testid="text-allowance">{formatCurrency(estimate.allowanceAmount)}</span>
            </div>
            <p className="text-xs text-muted-foreground italic pl-0">
              A 3% allowance of the total contract value is included as a budget for unforeseen conditions. Any unforeseen conditions that do not fit within this allowance will be addressed through a formal written change order.
            </p>
            <Separator />
            <div className="flex justify-between font-semibold text-lg">
              <span>Total</span>
              <span className="font-mono text-primary" data-testid="text-total">{formatCurrency(estimate.totalClientPrice)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Deposit Due Upon Acceptance</span>
              <span className="font-mono font-semibold" data-testid="text-deposit">{formatCurrency(estimate.depositAmount)}</span>
            </div>
          </CardContent>
        </Card>

        {/* Payment Schedule */}
        {estimate.milestones.length > 0 && (
          <Card className="mb-6 bg-white dark:bg-card" data-testid="card-payment-schedule">
            <CardContent className="pt-5">
              <h2 className="font-display text-lg font-bold mb-4">Payment Schedule</h2>
              <div className="space-y-3">
                {estimate.milestones.sort((a, b) => a.sortOrder - b.sortOrder).map((m, idx) => (
                  <div key={m.id} className="flex justify-between text-sm py-2 border-b last:border-0" data-testid={`payment-milestone-${idx}`}>
                    <span>{m.milestoneName}</span>
                    <span className="font-mono font-medium">{formatCurrency(m.amount)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Inclusions / Exclusions (collapsed) */}
        <div className="mb-8 space-y-2">
          <Collapsible>
            <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground w-full justify-between py-2" data-testid="toggle-inclusions">
              Inclusions
              <ChevronDown className="w-4 h-4" />
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2" data-testid="content-inclusions">
              <Card className="bg-white dark:bg-card">
                <CardContent className="pt-4 text-sm text-muted-foreground space-y-1">
                  <p>• All labor and materials as described in scope above</p>
                  <p>• Standard project management and site supervision</p>
                  <p>• Cleanup and debris removal</p>
                  <p>• Final walkthrough and punch list completion</p>
                  {estimate.permitRequired && <p>• Permit filing and processing</p>}
                </CardContent>
              </Card>
            </CollapsibleContent>
          </Collapsible>

          <Collapsible>
            <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground w-full justify-between py-2" data-testid="toggle-exclusions">
              Exclusions
              <ChevronDown className="w-4 h-4" />
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2" data-testid="content-exclusions">
              <Card className="bg-white dark:bg-card">
                <CardContent className="pt-4 text-sm text-muted-foreground space-y-1">
                  <p>• Furniture, fixtures, and equipment (FF&E) unless noted</p>
                  <p>• Appliance procurement unless noted</p>
                  <p>• Work outside the specified scope</p>
                  <p>• Hazardous material abatement if discovered</p>
                  <p>• Changes to structural elements not included in scope</p>
                </CardContent>
              </Card>
            </CollapsibleContent>
          </Collapsible>
        </div>

        {/* Accept & Sign */}
        {!isApproved && !isExpired && (
          <Card className="bg-white dark:bg-card border-primary/20" data-testid="card-accept-sign">
            <CardContent className="pt-6 space-y-4">
              <h2 className="font-display text-lg font-bold">Accept & Sign</h2>
              <div className="flex items-start gap-3">
                <Checkbox
                  checked={accepted}
                  onCheckedChange={(v) => setAccepted(v === true)}
                  data-testid="checkbox-accept"
                />
                <label className="text-sm leading-relaxed cursor-pointer" onClick={() => setAccepted(!accepted)}>
                  I have reviewed this estimate and accept the scope of work, pricing, and payment terms as described above.
                </label>
              </div>
              {accepted && (
                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium mb-1 block">Type your full name to sign</label>
                    <Input
                      value={signatureName}
                      onChange={e => setSignatureName(e.target.value)}
                      placeholder="Full Name"
                      className="max-w-sm"
                      data-testid="input-signature"
                    />
                  </div>
                  <Button
                    onClick={() => signMutation.mutate()}
                    disabled={!signatureName.trim() || signMutation.isPending}
                    className="gap-2"
                    data-testid="button-accept-sign"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    {signMutation.isPending ? "Signing..." : "Accept & Sign"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {isApproved && (
          <Card className="bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800" data-testid="card-approved">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-6 h-6 text-green-600" />
                <div>
                  <p className="font-semibold text-green-800 dark:text-green-300">Estimate Approved</p>
                  <p className="text-sm text-green-700 dark:text-green-400">
                    Signed by {estimate.signatureName} on {estimate.signatureTimestamp ? formatDateTime(estimate.signatureTimestamp) : "N/A"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {isExpired && !isApproved && (
          <Card className="bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800" data-testid="card-expired">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <AlertCircle className="w-6 h-6 text-red-600" />
                <div>
                  <p className="font-semibold text-red-800 dark:text-red-300">Estimate Expired</p>
                  <p className="text-sm text-red-700 dark:text-red-400">
                    This estimate expired on {formatDate(estimate.validUntil)}. Please contact us for a new estimate.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Footer */}
        <footer className="mt-12 pt-6 border-t text-center text-xs text-muted-foreground">
          <p>© {new Date().getFullYear()} 1 Degree Construction. All rights reserved.</p>
        </footer>
      </div>
    </div>
  );
}

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
