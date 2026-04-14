import { useQuery, useMutation } from "@tanstack/react-query";
import logoWhite from "@/assets/logo-white.png";
import logoDark from "@/assets/logo-dark.jpg";
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
import { AlertCircle, Phone, Mail, ChevronDown, CheckCircle2, Download, MessageCircle, Send, X } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { PHASE_GROUPS, GROUPED_PHASES } from "@shared/schema";
import type { Estimate, SalesRep, PaymentMilestone } from "@shared/schema";
import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useForceLightMode } from "@/components/theme-provider";
import { TrustCredentials } from "@/components/trust-credentials";

type ClientLineItem = {
  id: number;
  estimateId: number;
  sortOrder: number;
  phaseGroup: string;
  customPhaseLabel: string | null;
  scopeDescription: string;
  clientPrice: number;
  isGrouped: boolean;
};

type ClientEstimate = Omit<Estimate, "totalSubCost"> & {
  salesRep?: SalesRep;
  lineItems: ClientLineItem[];
  milestones: PaymentMilestone[];
};

function getPhaseLabel(value: string, customLabel?: string | null): string {
  if (value === "other" && customLabel) return customLabel;
  return PHASE_GROUPS.find(p => p.value === value)?.label || value;
}

function Logo() {
  return (
    <div className="flex items-center gap-3">
      <img src={logoDark} alt="1 Degree Construction" className="w-[60px] h-auto" />
      <div>
        <h1 className="font-display text-lg font-bold text-foreground leading-tight">1 Degree Construction</h1>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Topographic SVG pattern for cover page background
   ──────────────────────────────────────────────────────────────────────────── */
function TopographicPattern() {
  return (
    <svg
      className="absolute inset-0 w-full h-full opacity-[0.07]"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 1200 800"
    >
      <g fill="none" stroke="#ffffff" strokeWidth="1">
        {/* Layer 1 – large sweeping curves */}
        <path d="M-50 200 Q200 120 400 220 T800 180 T1250 250" />
        <path d="M-50 260 Q250 180 450 280 T850 240 T1250 310" />
        <path d="M-50 340 Q180 280 380 340 T780 300 T1250 380" />

        {/* Layer 2 */}
        <path d="M-50 420 Q220 360 480 420 T900 380 T1250 460" />
        <path d="M-50 480 Q260 420 500 490 T920 440 T1250 520" />
        <path d="M-50 550 Q200 500 440 560 T860 510 T1250 590" />

        {/* Layer 3 */}
        <path d="M-50 620 Q240 570 500 630 T900 580 T1250 660" />
        <path d="M-50 680 Q280 640 520 700 T920 650 T1250 720" />
        <path d="M-50 740 Q220 700 460 750 T880 710 T1250 780" />

        {/* Lighter accent curves */}
        <path d="M-50 100 Q300 40 600 120 T1250 80" strokeWidth="0.5" />
        <path d="M-50 160 Q280 100 560 170 T1250 140" strokeWidth="0.5" />
        <path d="M200 0 Q260 160 400 300 T600 600 T700 800" strokeWidth="0.5" />
        <path d="M600 0 Q640 120 700 280 T850 550 T900 800" strokeWidth="0.5" />
        <path d="M1000 0 Q980 180 940 350 T1050 600 T1100 800" strokeWidth="0.5" />
      </g>
    </svg>
  );
}



/* Small wordmark for letter page header */
function WordmarkSmall() {
  return (
    <img src={logoDark} alt="1 Degree Construction" className="w-[60px] h-auto" />
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Animated scroll-down chevron
   ──────────────────────────────────────────────────────────────────────────── */
function ScrollIndicator() {
  return (
    <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 animate-bounce-slow">
      <span className="text-white/50 text-[11px] uppercase tracking-[0.2em] font-light" style={{ fontFamily: "'General Sans', sans-serif" }}>
        Scroll
      </span>
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-white/40">
        <path d="M4 7 L10 13 L16 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Section 1: Cover Page
   ──────────────────────────────────────────────────────────────────────────── */
function CoverPage({ estimate }: { estimate: ClientEstimate }) {
  const formattedDate = new Date(estimate.createdAt).toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });

  const fullAddress = `${estimate.projectAddress}, ${estimate.city}, ${estimate.state} ${estimate.zip}`;

  return (
    <section
      className="relative min-h-screen flex flex-col overflow-hidden"
      style={{ backgroundColor: "#2D2F2E" }}
      data-testid="cover-page"
    >
      <TopographicPattern />

      {/* Top-left: Project details */}
      <div className="relative z-10 p-6 sm:p-10 pr-16 sm:pr-10 text-white text-[12px] sm:text-sm leading-relaxed max-w-[320px] sm:max-w-[360px]">
        <p><span className="font-semibold">Project Address:</span> {fullAddress}</p>
        <p><span className="font-semibold">Prepared By:</span> 1 Degree Construction</p>
        <p><span className="font-semibold">Prepared For:</span> {estimate.clientName}</p>
        <p><span className="font-semibold">Date:</span> {formattedDate}</p>
      </div>

      {/* Top-right: Rotated company address */}
      <div
        className="absolute top-6 right-6 sm:top-10 sm:right-10 z-10 text-white/60 text-[10px] sm:text-xs leading-snug"
        style={{
          writingMode: "vertical-rl",
          transform: "rotate(180deg)",
        }}
      >
        <p>13107 Ventura Blvd #206</p>
        <p>Studio City CA 91604</p>
      </div>

      {/* Center: Logo and text */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 -mt-8">
        <img src={logoWhite} alt="1 Degree Construction" className="w-[200px] h-auto mx-auto" />

        <div className="text-center mt-6 sm:mt-8">
          <p className="text-white/60 text-[11px] sm:text-xs tracking-wide mt-4 leading-relaxed" style={{ fontFamily: "'General Sans', sans-serif" }}>
            General Contractor | Design-Build
          </p>
          <p className="text-white/60 text-[11px] sm:text-xs tracking-wide mt-0.5 leading-relaxed" style={{ fontFamily: "'General Sans', sans-serif" }}>
            Remodel | ADU &amp; New Construction
          </p>
        </div>
      </div>

      {/* Bottom: Website and license */}
      <div className="relative z-10 flex items-center justify-between px-6 sm:px-10 pb-16 sm:pb-10 text-white/50 text-[11px] sm:text-xs">
        <span>www.1degreeconstruction.com</span>
        <span>Lic. #1075129</span>
      </div>

      <ScrollIndicator />
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Section 2: Welcome Letter
   ──────────────────────────────────────────────────────────────────────────── */
function WelcomeLetter({ estimate }: { estimate: ClientEstimate }) {
  const rep = estimate.salesRep;

  return (
    <section
      className="relative min-h-screen bg-white flex flex-col"
      data-testid="welcome-letter"
    >
      {/* Top-right wordmark */}
      <div className="flex justify-end p-6 sm:p-10">
        <WordmarkSmall />
      </div>

      {/* Letter body */}
      <div className="flex-1 flex items-start justify-center px-6 sm:px-16 md:px-24 pb-12">
        <div className="max-w-2xl w-full" style={{ fontFamily: "'Lora', Georgia, serif" }}>
          {/* Salutation */}
          <p className="text-gray-900 text-base sm:text-lg leading-relaxed mb-10 sm:mb-12">
            Dear {estimate.clientName},
          </p>

          {/* Body */}
          <div className="text-gray-700 text-[15px] sm:text-base leading-[1.85] space-y-6">
            <p>It was a pleasure to meet you.</p>

            <p>
              We want to extend our gratitude on behalf of 1 Degree Construction for considering us for your upcoming project.
            </p>

            <p>
              We specialize in projects that prioritize functional living spaces while embracing innovative design concepts. Our approach involves understanding your vision for both practical use and aesthetic appeal. By doing so, we aim to establish a solid foundation for a successful partnership and to ultimately deliver the home you've always envisioned.
            </p>

            <p>
              Should you decide to proceed with our services, I will be your primary point of contact. Please don't hesitate to reach out for any inquiries, comments, or feedback. Your satisfaction is our priority.
            </p>

            <p>
              Thank you once again for considering 1 Degree Remodel. We look forward to the possibility of working together to bring your dream home to life.
            </p>
          </div>

          {/* Sign-off */}
          <div className="mt-10 sm:mt-14">
            <p className="text-gray-700 text-[15px] sm:text-base mb-8" style={{ fontFamily: "'Lora', Georgia, serif" }}>
              Sincerely,
            </p>

            {rep && (
              <div className="text-gray-900 text-sm sm:text-[15px] leading-relaxed" style={{ fontFamily: "'General Sans', sans-serif" }}>
                <p className="font-semibold">{rep.name}</p>
                <p className="text-gray-600">{rep.title}</p>
                <p className="text-gray-600">{rep.email}</p>
                <p className="text-gray-600">{rep.phone}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Main Component
   ──────────────────────────────────────────────────────────────────────────── */
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
        label: getPhaseLabel(item.phaseGroup, item.customPhaseLabel),
        items: groupItems,
        collectivePrice: totalPrice,
      });
      processedPhases.add(item.phaseGroup);
    } else {
      displaySections.push({
        label: getPhaseLabel(item.phaseGroup, item.customPhaseLabel),
        items: [item],
        collectivePrice: null,
      });
      processedPhases.add(item.phaseGroup + "-" + item.id);
    }
  }

  // Recalculate subtotal from visible client prices
  const subtotal = sortedItems.reduce((sum, i) => sum + i.clientPrice, 0);

  // Calculate discount ratio for line item display
  const eAny = estimate as any;
  const hasDiscount = (eAny.apparentDiscountType && eAny.apparentDiscountValue > 0) || (eAny.realDiscountType && eAny.realDiscountValue > 0);
  let discountRatio = 1; // ratio of discounted price to original
  if (hasDiscount) {
    let originalTotal = estimate.totalClientPrice;
    if (eAny.apparentDiscountType && eAny.apparentDiscountValue > 0) {
      if (eAny.apparentDiscountType === "percent") {
        originalTotal = Math.round(estimate.totalClientPrice / (1 - eAny.apparentDiscountValue / 100) * 100) / 100;
      } else {
        originalTotal = estimate.totalClientPrice + eAny.apparentDiscountValue;
      }
    }
    if (eAny.realDiscountType && eAny.realDiscountValue > 0 && !(eAny.apparentDiscountType && eAny.apparentDiscountValue > 0)) {
      if (eAny.realDiscountType === "percent") {
        originalTotal = Math.round(estimate.totalClientPrice / (1 - eAny.realDiscountValue / 100) * 100) / 100;
      } else {
        originalTotal = estimate.totalClientPrice + eAny.realDiscountValue;
      }
    }
    discountRatio = originalTotal > 0 ? estimate.totalClientPrice / originalTotal : 1;
  }

  return (
    <>
      {/* ── SECTION 1: Cover Page ─────────────────────────────────────────── */}
      <div className="no-print">
        <CoverPage estimate={estimate} />
      </div>

      {/* ── SECTION 2: Welcome Letter ─────────────────────────────────────── */}
      <WelcomeLetter estimate={estimate} />

      {/* ── SECTION 3: Trust & Credentials ─────────────────────────────────── */}
      <div className="no-print">
        <TrustCredentials salesRep={estimate.salesRep} />
      </div>

      {/* ── SECTION 4: Existing Estimate Content (unchanged) ──────────────── */}
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
                    {(() => {
                      const originalPrice = section.collectivePrice !== null ? section.collectivePrice : section.items[0].clientPrice;
                      const discountedPrice = Math.round(originalPrice * discountRatio * 100) / 100;
                      if (hasDiscount && discountRatio < 1) {
                        const pctOff = Math.round((1 - discountRatio) * 100);
                        return (
                          <div className="text-right flex items-center gap-2">
                            <span className="font-mono text-xs text-muted-foreground line-through">{formatCurrency(originalPrice)}</span>
                            <span className="font-mono text-sm font-semibold text-green-600 dark:text-green-400">{formatCurrency(discountedPrice)}</span>
                            <span className="text-[10px] font-semibold text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-500/15 px-1.5 py-0.5 rounded">{pctOff}% off</span>
                          </div>
                        );
                      }
                      return <span className="font-mono text-sm font-semibold">{formatCurrency(originalPrice)}</span>;
                    })()}
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
              {/* Discount display */}
              {(() => {
                const e = estimate as any;
                const hasApparent = e.apparentDiscountType && e.apparentDiscountValue > 0;
                const hasReal = e.realDiscountType && e.realDiscountValue > 0;
                if (!hasApparent && !hasReal) return null;

                // Calculate what the client sees
                let originalPrice = estimate.totalClientPrice;
                let savings = 0;
                if (hasApparent) {
                  if (e.apparentDiscountType === "percent") {
                    originalPrice = Math.round(estimate.totalClientPrice / (1 - e.apparentDiscountValue / 100) * 100) / 100;
                  } else {
                    originalPrice = estimate.totalClientPrice + e.apparentDiscountValue;
                  }
                  savings += originalPrice - estimate.totalClientPrice;
                }
                if (hasReal) {
                  // Real discount is already baked into totalClientPrice
                  if (e.realDiscountType === "percent") {
                    const preReal = Math.round(estimate.totalClientPrice / (1 - e.realDiscountValue / 100) * 100) / 100;
                    savings += preReal - estimate.totalClientPrice;
                    if (!hasApparent) originalPrice = preReal;
                  } else {
                    savings += e.realDiscountValue;
                    if (!hasApparent) originalPrice = estimate.totalClientPrice + e.realDiscountValue;
                  }
                }

                const savingsPct = originalPrice > 0 ? Math.round((savings / originalPrice) * 100) : 0;
                return (
                  <div className="bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20 rounded-lg p-3 mb-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Original Price</span>
                      <span className="font-mono line-through text-muted-foreground">{formatCurrency(originalPrice)}</span>
                    </div>
                    <div className="flex justify-between text-sm font-semibold text-green-700 dark:text-green-400">
                      <span>You Save ({savingsPct}%)</span>
                      <span className="font-mono">-{formatCurrency(savings)}</span>
                    </div>
                  </div>
                );
              })()}
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

          {/* Project-Specific Inclusions & Exclusions (visible by default) */}
          {((estimate as any).projectInclusions || (estimate as any).projectExclusions) && (
            <div className="mb-6 space-y-4" data-testid="project-inclusions-exclusions">
              {(estimate as any).projectInclusions && (
                <div
                  className="border-l-4 border-primary/60 bg-white dark:bg-card rounded-r-lg overflow-hidden shadow-sm"
                  data-testid="card-project-inclusions"
                >
                  <div className="px-4 py-3 bg-primary/5 border-b border-primary/10">
                    <h3 className="font-semibold text-sm text-foreground">Project Inclusions</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">Specific to this project</p>
                  </div>
                  <div className="px-4 py-4">
                    <ul className="space-y-1.5">
                      {(estimate as any).projectInclusions
                        .split("\n")
                        .map((line: string) => line.trim())
                        .filter((line: string) => line.length > 0)
                        .map((line: string, i: number) => (
                          <li key={i} className="text-sm text-foreground/80 leading-relaxed">
                            {line.startsWith("•") ? line : `• ${line}`}
                          </li>
                        ))
                      }
                    </ul>
                  </div>
                </div>
              )}
              {(estimate as any).projectExclusions && (
                <div
                  className="border-l-4 border-amber-500/60 bg-white dark:bg-card rounded-r-lg overflow-hidden shadow-sm"
                  data-testid="card-project-exclusions"
                >
                  <div className="px-4 py-3 bg-amber-50 dark:bg-amber-900/10 border-b border-amber-200/50">
                    <h3 className="font-semibold text-sm text-foreground">Project Exclusions</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">Not included in this estimate</p>
                  </div>
                  <div className="px-4 py-4">
                    <ul className="space-y-1.5">
                      {(estimate as any).projectExclusions
                        .split("\n")
                        .map((line: string) => line.trim())
                        .filter((line: string) => line.length > 0)
                        .map((line: string, i: number) => (
                          <li key={i} className="text-sm text-foreground/80 leading-relaxed">
                            {line.startsWith("•") ? line : `• ${line}`}
                          </li>
                        ))
                      }
                    </ul>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Inclusions / Exclusions / Terms & Conditions (collapsed) */}
          <div className="no-print mb-8 space-y-2">
            <Collapsible>
              <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground w-full justify-between py-2" data-testid="toggle-inclusions">
                Inclusions
                <ChevronDown className="w-4 h-4" />
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2" data-testid="content-inclusions">
                <Card className="bg-white dark:bg-card">
                  <CardContent className="pt-4 text-sm text-muted-foreground space-y-4">
                    <div>
                      <p className="font-semibold text-foreground mb-1">Labor</p>
                      <p>All labor necessary to complete the scope of work, including:</p>
                      <p>• Demolition, framing, rough plumbing, rough electrical, drywall, insulation, and structural work as needed.</p>
                    </div>
                    <div>
                      <p className="font-semibold text-foreground mb-1">Labor Standards</p>
                      <p>All work will be performed to standard General Contractor (GC) grade labor expectations unless explicitly stated otherwise.</p>
                      <p className="mt-1">For example:</p>
                      <p>• Countertop installation includes prefab 9x2 or 10x2 countertops, pre-finished and sealed from the factory. Custom slab fabrication and finishing are excluded.</p>
                      <p>• Tile installation includes standard ceramic tile (12x24 or larger), excluding small-format or mosaic tile layouts.</p>
                    </div>
                    <div>
                      <p className="font-semibold text-foreground mb-1">Rough Construction Materials</p>
                      <p>• Framing materials: Lumber (e.g., 2x4s), screws, nails, plates, and brackets.</p>
                      <p>• Drywall, insulation (to code), texture compounds, and taping materials.</p>
                      <p>• Concrete or base materials for structural needs.</p>
                      <p>• Waterproofing systems in wet areas, such as floating cement and membranes.</p>
                      <p>• Electrical rough-in: Wiring, junction boxes, panels, outlets, switches, and GC-grade recessed LED lights.</p>
                      <p>• Plumbing rough-in: Supply lines, drain lines, and in-wall components (excluding finish-grade valves or fixtures).</p>
                    </div>
                    <div>
                      <p className="font-semibold text-foreground mb-1">Painting</p>
                      <p>Includes GC-grade paint for walls and ceilings.</p>
                    </div>
                    <div>
                      <p className="font-semibold text-foreground mb-1">Site Preparation</p>
                      <p>• Dust protection, floor coverings, and debris management to minimize disruption to the home.</p>
                    </div>
                    <div>
                      <p className="font-semibold text-foreground mb-1">Cleanup</p>
                      <p>• Broom-clean condition at the end of the project.</p>
                      <p>• Haul-away of demolition and construction debris.</p>
                    </div>
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
                  <CardContent className="pt-4 text-sm text-muted-foreground space-y-4">
                    <div>
                      <p className="font-semibold text-foreground mb-1">Finished Materials and Labor</p>
                      <p>• Countertops: Fabrication of custom slabs (marble, granite, quartz) and specialty finishes.</p>
                      <p>• Plumbing Fixtures: Faucets, showerheads, drains, tub fillers, and visible fixtures.</p>
                      <p>• Electrical Fixtures: Decorative sconces, pendants, and other lighting.</p>
                      <p>• Vanities and cabinetry beyond standard GC-grade options.</p>
                      <p>• Doors, door frames, and associated hardware.</p>
                      <p>• Tiles and flooring materials (e.g., grout, mortar, decorative blends, mosaics).</p>
                      <p>• Mirrors, bathroom accessories (e.g., towel bars, robe hooks).</p>
                      <p>• Appliances and their installation.</p>
                    </div>
                    <div>
                      <p className="font-semibold text-foreground mb-1">Upgrades and Specialty Features</p>
                      <p>• Utility upgrades: Electrical panels, water or gas supply lines beyond existing walls.</p>
                      <p>• Custom finishes: Niches, mosaic tiles, or hand-cut designs.</p>
                      <p>• Specialty HVAC work, duct cleaning, or upgrades.</p>
                    </div>
                    <div>
                      <p className="font-semibold text-foreground mb-1">Additional Services</p>
                      <p>• Hazardous material testing, removal, or remediation (e.g., asbestos, lead, mold).</p>
                      <p>• Design, engineering, or 3D rendering services.</p>
                      <p>• Permits, city fees, and inspection costs.</p>
                      <p>• Structural repairs outside the stated scope of work.</p>
                      <p>• Work outside wall surfaces (e.g., siding, external utilities).</p>
                    </div>
                  </CardContent>
                </Card>
              </CollapsibleContent>
            </Collapsible>

            <Collapsible>
              <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground w-full justify-between py-2" data-testid="toggle-terms">
                Standard Terms & Conditions
                <ChevronDown className="w-4 h-4" />
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2" data-testid="content-terms">
                <Card className="bg-white dark:bg-card">
                  <CardContent className="pt-4 text-sm text-muted-foreground space-y-4">
                    <div>
                      <p className="font-semibold text-foreground mb-1">1. Standard of Care</p>
                      <p>All work will comply with the approved plans, industry standards, and applicable codes. In case of a conflict, the Home Improvement Construction Agreement (HIC) and Addendum take precedence.</p>
                    </div>
                    <div>
                      <p className="font-semibold text-foreground mb-1">2. Cost of Work</p>
                      <p>Prices are valid for forty-five (45) days. After this period, the Contractor reserves the right to adjust pricing through a detailed change order.</p>
                    </div>
                    <div>
                      <p className="font-semibold text-foreground mb-1">3. Pre-existing Conditions and Scope Gaps</p>
                      <p>The Contractor is not responsible for addressing pre-existing deficiencies or missing details outside the defined scope of work. Repairs for unforeseen conditions such as dry rot, termite damage, or water damage require a signed change order.</p>
                    </div>
                    <div>
                      <p className="font-semibold text-foreground mb-1">Cancellation of Line Items</p>
                      <p>The client agrees to a 30% liquidation fee for canceling or removing any line item or portion of the project after the standard three-day cancellation period. This fee applies to:</p>
                      <p className="mt-1 font-medium text-foreground">Labor and Materials</p>
                      <p>Labor and materials are based on GC-grade performance. For example:</p>
                      <p>• Tile labor includes standard ceramic tile installation, but specialty patterns, mosaics, or hand-cut tiles require additional charges.</p>
                      <p>• Countertop labor includes prefab 9x2 or 10x2 slabs that are pre-finished and sealed from the factory. Custom slab fabrication or full-size slab installation is excluded unless explicitly agreed upon.</p>
                      <p>• Electrical labor includes basic wiring and recessed lighting but excludes decorative fixtures or specialty controls (e.g., smart home systems).</p>
                      <p>• Plumbing labor includes rough-in supply and drain lines but excludes wall-hung units or custom valve setups.</p>
                      <p>Changes requiring upgrades beyond GC-grade standards will incur a change order and additional fees.</p>
                      <p className="mt-1 font-medium text-foreground">Project Scheduling and Resources</p>
                      <p>Cancellations impact project timelines and resource allocation. The liquidation fee compensates for scheduling disruptions, resource commitment, and lost opportunities.</p>
                    </div>
                    <div>
                      <p className="font-semibold text-foreground mb-1">4. Change Orders</p>
                      <p>All change orders must be signed via DocuSign or wet signature before work begins. Verbal agreements will not be honored.</p>
                    </div>
                    <div>
                      <p className="font-semibold text-foreground mb-1">5. Warranty Provisions</p>
                      <p>A one-year limited workmanship warranty is provided, excluding:</p>
                      <p>• Misuse, neglect, abuse, acts of God, or normal wear and tear.</p>
                      <p>• Alterations by third parties void the warranty.</p>
                    </div>
                    <div>
                      <p className="font-semibold text-foreground mb-1">6. Jobsite Access and Safety</p>
                      <p>The client must ensure safe working conditions. Delays due to access or safety issues require resolution and may incur additional costs.</p>
                    </div>
                    <div>
                      <p className="font-semibold text-foreground mb-1">7. Lien Rights</p>
                      <p>The Contractor reserves the right to issue a lien for unpaid invoices beyond thirty (30) days.</p>
                    </div>
                    <div>
                      <p className="font-semibold text-foreground mb-1">8. Force Majeure</p>
                      <p>The Contractor is not liable for delays caused by uncontrollable events such as natural disasters or supply chain disruptions.</p>
                    </div>
                    <div>
                      <p className="font-semibold text-foreground mb-1">Clarifications</p>
                      <p>• Material Variations: Natural materials may exhibit variations in color, texture, or aging due to environmental factors.</p>
                      <p>• Concrete Cracks: Minor cracking in concrete due to settlement is common and not covered under warranty.</p>
                      <p>• Tile and Pattern Matching: Custom patterns or blends require client oversight. Additional charges apply for mosaic or small-format tile installations.</p>
                    </div>
                  </CardContent>
                </Card>
              </CollapsibleContent>
            </Collapsible>
          </div>

          {/* Download PDF link */}
          <div className="no-print text-center mb-6">
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              data-testid="button-download-pdf-client"
            >
              <Download className="w-3.5 h-3.5" />
              Download PDF
            </button>
          </div>

          {/* Accept & Sign */}
          {!isApproved && !isExpired && (
            <Card className="no-print bg-white dark:bg-card border-primary/20" data-testid="card-accept-sign">
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
            <Card className="no-print bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800" data-testid="card-approved">
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
            <Card className="no-print bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800" data-testid="card-expired">
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
          <footer className="no-print mt-12 pt-6 border-t text-center text-xs text-muted-foreground">
            <p>© {new Date().getFullYear()} 1 Degree Construction. All rights reserved.</p>
          </footer>
        </div>
      </div>

      {/* Chat widget */}
      <ChatWidget uniqueId={params.uniqueId} clientName={estimate.clientName} salesRep={estimate.salesRep} />
    </>
  );
}

function formatDateTime(dateStr: string | Date): string {
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ── Chat Widget ─────────────────────────────────────────────────────────────
interface ChatMsg { id: number; senderType: string; senderName: string; message: string; createdAt: string; }

function ChatWidget({ uniqueId, clientName, salesRep }: { uniqueId: string; clientName: string; salesRep?: SalesRep }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: messages = [], refetch } = useQuery<ChatMsg[]>({
    queryKey: ["/api/estimates/public", uniqueId, "messages"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/estimates/public/${uniqueId}/messages`);
      return res.json();
    },
    refetchInterval: open ? 30000 : false,
  });

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  const handleSend = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      await apiRequest("POST", `/api/estimates/public/${uniqueId}/messages`, {
        senderName: clientName || "Client",
        message: text.trim(),
      });
      setText("");
      refetch();
    } catch { /* noop */ }
    setSending(false);
  };

  const unread = messages.filter(m => m.senderType === "team" && !open).length;

  return (
    <div className="fixed bottom-5 right-5 z-50" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {/* Chat bubble button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="w-14 h-14 rounded-full bg-[#e87722] text-white shadow-lg hover:bg-[#d06a1e] transition-all flex items-center justify-center relative"
          data-testid="button-open-chat"
        >
          <MessageCircle className="w-6 h-6" />
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center">{unread}</span>
          )}
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div className="w-80 sm:w-96 bg-white rounded-xl shadow-2xl border border-gray-200 flex flex-col" style={{ height: "420px" }}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-[#0a0a0a] rounded-t-xl">
            <div>
              <p className="text-white text-sm font-semibold">1 Degree Construction</p>
              <p className="text-gray-400 text-xs">{salesRep ? `${salesRep.name} - ${salesRep.phone}` : "We typically reply within a few hours"}</p>
            </div>
            <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-gray-50">
            {messages.length === 0 && (
              <div className="text-center text-gray-400 text-xs mt-8">
                Have a question about your estimate?<br />Send us a message below.
              </div>
            )}
            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.senderType === "client" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                  msg.senderType === "client"
                    ? "bg-[#e87722] text-white rounded-br-none"
                    : "bg-white border border-gray-200 text-gray-800 rounded-bl-none"
                }`}>
                  {msg.senderType === "team" && (
                    <p className="text-[10px] font-semibold text-gray-500 mb-0.5">{msg.senderName}</p>
                  )}
                  <p className="whitespace-pre-wrap">{msg.message}</p>
                  <p className={`text-[10px] mt-1 ${msg.senderType === "client" ? "text-orange-200" : "text-gray-400"}`}>
                    {new Date(msg.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                  </p>
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="p-3 border-t border-gray-200 bg-white rounded-b-xl">
            <div className="flex gap-2">
              <input
                type="text"
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSend()}
                placeholder="Type a message..."
                className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#e87722]/30 focus:border-[#e87722]"
                data-testid="input-chat-message"
              />
              <button
                onClick={handleSend}
                disabled={!text.trim() || sending}
                className="px-3 py-2 bg-[#e87722] text-white rounded-lg hover:bg-[#d06a1e] disabled:opacity-50 transition-colors"
                data-testid="button-send-chat"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
