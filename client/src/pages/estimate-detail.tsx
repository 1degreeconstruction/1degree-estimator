import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { AdminLayout } from "@/components/admin-layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Edit, ExternalLink, Copy, Send, ArrowLeft,
  Clock, Eye, CheckCircle, AlertCircle, FileText, Download
} from "lucide-react";
import { formatCurrency, formatDate, formatDateTime, getStatusColor, getStatusLabel } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PHASE_GROUPS, GROUPED_PHASES } from "@shared/schema";
import type { Estimate, SalesRep, LineItem, PaymentMilestone, EstimateEvent } from "@shared/schema";

type EstimateDetail = Estimate & {
  salesRep?: SalesRep;
  lineItems: LineItem[];
  milestones: PaymentMilestone[];
  events: EstimateEvent[];
};

function getPhaseLabel(value: string, customLabel?: string | null): string {
  if (value === "other" && customLabel) return customLabel;
  return PHASE_GROUPS.find(p => p.value === value)?.label || value;
}

function getEventIcon(type: string) {
  switch (type) {
    case "created": return <FileText className="w-4 h-4 text-muted-foreground" />;
    case "sent": return <Send className="w-4 h-4 text-blue-500" />;
    case "viewed": return <Eye className="w-4 h-4 text-purple-500" />;
    case "approved": return <CheckCircle className="w-4 h-4 text-green-500" />;
    default: return <Clock className="w-4 h-4 text-orange-500" />;
  }
}

export default function EstimateDetailPage() {
  const params = useParams<{ id: string }>();
  const { toast } = useToast();

  const { data: estimate, isLoading } = useQuery<EstimateDetail>({
    queryKey: ["/api/estimates", params.id],
  });

  const resendMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/estimates/${params.id}/status`, { status: "sent" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/estimates", params.id] });
      toast({ title: "Estimate resent" });
    },
  });

  const copyLink = () => {
    if (!estimate) return;
    const url = `${window.location.origin}${window.location.pathname}#/estimate/${estimate.uniqueId}`;
    navigator.clipboard.writeText(url).then(() => {
      toast({ title: "Link copied", description: "Client estimate link copied to clipboard." });
    }).catch(() => {
      toast({ title: "Copy link", description: url });
    });
  };

  if (isLoading) {
    return (
      <AdminLayout>
        <div className="p-6 max-w-5xl mx-auto space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </AdminLayout>
    );
  }

  if (!estimate) {
    return (
      <AdminLayout>
        <div className="p-6 text-center py-16">
          <AlertCircle className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="font-medium mb-2">Estimate not found</h3>
          <Link href="/"><Button variant="outline">Back to Dashboard</Button></Link>
        </div>
      </AdminLayout>
    );
  }

  // Group line items by phase
  const groupedItems: Record<string, LineItem[]> = {};
  const sortedItems = [...estimate.lineItems].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const item of sortedItems) {
    if (!groupedItems[item.phaseGroup]) groupedItems[item.phaseGroup] = [];
    groupedItems[item.phaseGroup].push(item);
  }

  return (
    <AdminLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-6 pb-16">
        {/* Header */}
        <div className="flex items-start justify-between gap-4" data-testid="detail-header">
          <div>
            <Link href="/">
              <span className="text-sm text-muted-foreground hover:text-foreground cursor-pointer inline-flex items-center gap-1 mb-2">
                <ArrowLeft className="w-3 h-3" /> Back to Dashboard
              </span>
            </Link>
            <div className="flex items-center gap-3">
              <h1 className="font-display text-xl font-bold" data-testid="text-estimate-number">
                {estimate.estimateNumber}
              </h1>
              <Badge className={`${getStatusColor(estimate.status)}`} data-testid="badge-status">
                {getStatusLabel(estimate.status)}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Created {formatDate(estimate.createdAt)} · Valid until {formatDate(estimate.validUntil)}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={copyLink} className="gap-2" data-testid="button-copy-link">
              <Copy className="w-4 h-4" /> Copy Link
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              data-testid="button-download-pdf"
              onClick={() => {
                const printUrl = `${window.location.origin}${window.location.pathname}#/estimate/${estimate.uniqueId}`;
                const printWindow = window.open(printUrl, '_blank');
                if (printWindow) {
                  printWindow.addEventListener('load', () => {
                    setTimeout(() => printWindow.print(), 1000);
                  });
                }
              }}
            >
              <Download className="w-4 h-4" /> Download PDF
            </Button>
            <Link href={`/estimate/${estimate.uniqueId}`}>
              <Button variant="outline" size="sm" className="gap-2" data-testid="button-preview">
                <ExternalLink className="w-4 h-4" /> Preview
              </Button>
            </Link>
            <Link href={`/estimates/${estimate.id}/edit`}>
              <Button variant="outline" size="sm" className="gap-2" data-testid="button-edit">
                <Edit className="w-4 h-4" /> Edit
              </Button>
            </Link>
            {(estimate.status === "draft" || estimate.status === "viewed") && (
              <Button size="sm" className="gap-2" onClick={() => resendMutation.mutate()} disabled={resendMutation.isPending} data-testid="button-resend">
                <Send className="w-4 h-4" /> {estimate.status === "draft" ? "Send" : "Resend"}
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left - Details */}
          <div className="lg:col-span-2 space-y-6">
            {/* Client & Rep Info */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Card data-testid="card-client-info">
                <CardHeader className="pb-3">
                  <CardTitle className="text-xs text-muted-foreground uppercase tracking-wider">Client</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="font-semibold text-sm" data-testid="text-client-name">{estimate.clientName}</p>
                  <p className="text-sm text-muted-foreground">{estimate.clientEmail}</p>
                  <p className="text-sm text-muted-foreground">{estimate.clientPhone}</p>
                  <p className="text-sm text-muted-foreground mt-2">
                    {estimate.projectAddress}<br />
                    {estimate.city}, {estimate.state} {estimate.zip}
                  </p>
                </CardContent>
              </Card>
              <Card data-testid="card-sales-rep">
                <CardHeader className="pb-3">
                  <CardTitle className="text-xs text-muted-foreground uppercase tracking-wider">Sales Rep</CardTitle>
                </CardHeader>
                <CardContent>
                  {estimate.salesRep && (
                    <>
                      <p className="font-semibold text-sm">{estimate.salesRep.name}</p>
                      <p className="text-sm text-muted-foreground">{estimate.salesRep.title}</p>
                      <p className="text-sm text-muted-foreground">{estimate.salesRep.email}</p>
                      <p className="text-sm text-muted-foreground">{estimate.salesRep.phone}</p>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Line Items with Internal Breakdown */}
            <Card data-testid="card-line-items">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">Line Items — Internal Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="table-line-items">
                    <thead>
                      <tr className="border-b text-xs text-muted-foreground uppercase tracking-wider">
                        <th className="text-left py-2 pr-4">Phase</th>
                        <th className="text-left py-2 pr-4">Scope</th>
                        <th className="text-right py-2 pr-4">Sub Cost</th>
                        <th className="text-right py-2 pr-4">Client Price</th>
                        <th className="text-right py-2">Margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedItems.map((item, idx) => (
                        <tr key={item.id} className="border-b last:border-0" data-testid={`row-line-item-${idx}`}>
                          <td className="py-3 pr-4 align-top">
                            <span className="text-xs font-medium">{getPhaseLabel(item.phaseGroup, (item as any).customPhaseLabel)}</span>
                            {item.isGrouped && (
                              <span className="ml-1 text-xs text-primary">(grouped)</span>
                            )}
                          </td>
                          <td className="py-3 pr-4 align-top text-muted-foreground">{item.scopeDescription}</td>
                          <td className="py-3 pr-4 text-right align-top font-mono text-xs">{formatCurrency(item.subCost)}</td>
                          <td className="py-3 pr-4 text-right align-top font-mono text-xs">{formatCurrency(item.clientPrice)}</td>
                          <td className="py-3 text-right align-top font-mono text-xs text-green-600 dark:text-green-400">
                            {formatCurrency(item.clientPrice - item.subCost)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Payment Milestones */}
            {estimate.milestones.length > 0 && (
              <Card data-testid="card-milestones">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold">Payment Schedule</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {estimate.milestones.sort((a, b) => a.sortOrder - b.sortOrder).map((m, idx) => (
                      <div key={m.id} className="flex justify-between text-sm" data-testid={`milestone-row-${idx}`}>
                        <span className="text-muted-foreground">{m.milestoneName}</span>
                        <span className="font-mono">{formatCurrency(m.amount)}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Internal Notes */}
            {estimate.notesInternal && (
              <Card data-testid="card-notes">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold">Internal Notes</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{estimate.notesInternal}</p>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right - Summary & Timeline */}
          <div className="space-y-6">
            {/* Financial Summary */}
            <Card data-testid="card-summary">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">Financial Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Internal Cost</span>
                  <span className="font-mono">{formatCurrency(estimate.totalSubCost)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Client Subtotal</span>
                  <span className="font-mono">{formatCurrency(estimate.totalSubCost * 2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">3% Allowance</span>
                  <span className="font-mono">{formatCurrency(estimate.allowanceAmount)}</span>
                </div>
                <Separator />
                <div className="flex justify-between font-semibold">
                  <span>Total</span>
                  <span className="font-mono text-primary" data-testid="text-detail-total">{formatCurrency(estimate.totalClientPrice)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Deposit</span>
                  <span className="font-mono">{formatCurrency(estimate.depositAmount)}</span>
                </div>
                <Separator />
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Gross Margin</span>
                  <span className="font-mono text-green-600 dark:text-green-400">
                    {formatCurrency(estimate.totalClientPrice - estimate.totalSubCost - estimate.allowanceAmount)}
                  </span>
                </div>
                {estimate.permitRequired && (
                  <div className="mt-2">
                    <Badge variant="outline" className="text-xs">Permit Required</Badge>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Event Timeline */}
            <Card data-testid="card-timeline">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">Activity Timeline</CardTitle>
              </CardHeader>
              <CardContent>
                {estimate.events.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No events yet.</p>
                ) : (
                  <div className="space-y-4">
                    {[...estimate.events].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).map((event, idx) => (
                      <div key={event.id} className="flex items-start gap-3" data-testid={`event-${idx}`}>
                        {getEventIcon(event.eventType)}
                        <div className="min-w-0">
                          <p className="text-sm font-medium capitalize">{event.eventType.replace(/_/g, " ")}</p>
                          <p className="text-xs text-muted-foreground">{formatDateTime(event.timestamp)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Signature Info */}
            {estimate.signatureName && (
              <Card data-testid="card-signature">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold">Signature</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="font-semibold text-sm">{estimate.signatureName}</p>
                  {estimate.signatureTimestamp && (
                    <p className="text-xs text-muted-foreground">{formatDateTime(estimate.signatureTimestamp)}</p>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
