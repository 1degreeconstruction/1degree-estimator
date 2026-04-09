import { useState, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/admin-layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { getToken } from "@/lib/auth";
import {
  Upload, FileText, CheckCircle, AlertCircle, Clock, Loader2,
  ChevronDown, ChevronUp, ExternalLink, RefreshCw, Eye, EyeOff
} from "lucide-react";
import type { Estimate } from "@shared/schema";

interface ParsedItem {
  trade: string;
  description: string;
  amount: number;
  unit: string;
}

interface ParsedData {
  subName?: string;
  subPhone?: string;
  date?: string;
  projectAddress?: string;
  items?: ParsedItem[];
  total?: number;
  confidence?: "high" | "medium" | "low";
  error?: string;
  clarifyingQuestions?: Array<{
    itemIndex: number;
    question: string;
    reason: string;
  }>;
}

interface PurchaseOrder {
  id: number;
  estimateId: number | null;
  uploadedByUserId: number | null;
  filename: string;
  fileUrl: string;
  rawOcrText: string | null;
  parsedData: ParsedData | null;
  status: string;
  notes: string | null;
  createdAt: string;
}

const TRADE_OPTIONS = [
  "plumbing", "electrical", "demolition", "framing", "drywall",
  "paint", "tile", "hvac", "general", "other"
];

const UNIT_OPTIONS = ["per job", "per room", "per SF", "per LF", "per item", "lump sum"];

function statusBadge(status: string) {
  switch (status) {
    case "pending":
      return <Badge variant="secondary" className="gap-1"><Clock className="w-3 h-3" />Pending</Badge>;
    case "ocr_complete":
      return <Badge className="gap-1 bg-blue-500 text-white"><Eye className="w-3 h-3" />OCR Complete</Badge>;
    case "parsed":
      return <Badge className="gap-1 bg-amber-500 text-white"><FileText className="w-3 h-3" />Parsed – Review Needed</Badge>;
    case "confirmed":
      return <Badge className="gap-1 bg-green-600 text-white"><CheckCircle className="w-3 h-3" />Confirmed</Badge>;
    case "error":
      return <Badge variant="destructive" className="gap-1"><AlertCircle className="w-3 h-3" />Error</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function confidenceBadge(confidence?: string) {
  if (!confidence) return null;
  switch (confidence) {
    case "high":
      return <Badge className="bg-green-600 text-white text-xs">High Confidence</Badge>;
    case "medium":
      return <Badge className="bg-amber-500 text-white text-xs">Medium Confidence</Badge>;
    case "low":
      return <Badge variant="destructive" className="text-xs">Low Confidence</Badge>;
    default:
      return null;
  }
}

function UploadZone({ onUpload }: { onUpload: (file: File, estimateId?: string, notes?: string) => void }) {
  const [dragging, setDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [estimateId, setEstimateId] = useState("");
  const [notes, setNotes] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: estimates } = useQuery<Estimate[]>({ queryKey: ["/api/estimates"] });

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) setSelectedFile(file);
  }, []);

  const handleSubmit = () => {
    if (!selectedFile) return;
    onUpload(selectedFile, estimateId || undefined, notes || undefined);
    setSelectedFile(null);
    setEstimateId("");
    setNotes("");
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Upload className="w-4 h-4" />
          Upload Sub Invoice or Purchase Order
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Drop zone */}
        <div
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
            dragging
              ? "border-primary bg-primary/5"
              : "border-muted-foreground/30 hover:border-primary/60 hover:bg-muted/30"
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
          {selectedFile ? (
            <div>
              <p className="font-medium text-sm">{selectedFile.name}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
          ) : (
            <div>
              <p className="text-sm font-medium">Drop file here or click to browse</p>
              <p className="text-xs text-muted-foreground mt-1">PDF, JPG, PNG — max 10MB</p>
              <p className="text-xs text-muted-foreground">Handwritten invoices supported</p>
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) setSelectedFile(file);
            }}
          />
        </div>

        {selectedFile && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Associate with estimate */}
            <div className="space-y-1.5">
              <Label className="text-xs">Link to Estimate (optional)</Label>
              <Select value={estimateId} onValueChange={setEstimateId}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {estimates?.map(e => (
                    <SelectItem key={e.id} value={String(e.id)}>
                      {e.estimateNumber} — {e.clientName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {/* Notes */}
            <div className="space-y-1.5">
              <Label className="text-xs">Notes (optional)</Label>
              <Input
                className="h-8 text-sm"
                placeholder="e.g. Plumbing sub – Shower remodel"
                value={notes}
                onChange={e => setNotes(e.target.value)}
              />
            </div>
          </div>
        )}

        <Button
          onClick={handleSubmit}
          disabled={!selectedFile}
          className="w-full gap-2"
        >
          <Upload className="w-4 h-4" />
          Upload & Extract Pricing
        </Button>
      </CardContent>
    </Card>
  );
}

function PORow({ po, onRefresh }: { po: PurchaseOrder; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(po.status === "parsed" || po.status === "error");
  const [showOcr, setShowOcr] = useState(false);
  const [editedItems, setEditedItems] = useState<ParsedItem[]>(po.parsedData?.items || []);
  const [clarifyAnswers, setClarifyAnswers] = useState<Record<number, string>>({});
  const [clarifySubmitted, setClarifySubmitted] = useState(false);
  const [clarifyLoading, setClarifyLoading] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const questions = po.parsedData?.clarifyingQuestions || [];
  const unansweredQuestions = questions.filter(q => !clarifyAnswers[q.itemIndex] && !clarifySubmitted);

  const handleClarifySubmit = async () => {
    if (Object.keys(clarifyAnswers).length === 0) return;
    setClarifyLoading(true);
    try {
      // Re-parse with the clarifying context appended
      const context = questions.map(q => `Q: ${q.question}\nA: ${clarifyAnswers[q.itemIndex] || "(no answer)"}`).join("\n");
      const res = await apiRequest("POST", `/api/purchase-orders/${po.id}/parse`, { additionalContext: context });
      const data = await res.json();
      setClarifySubmitted(true);
      onRefresh();
      toast({ title: "Updated", description: "Pricing refined with your answers." });
    } catch {
      toast({ title: "Error", description: "Could not refine pricing.", variant: "destructive" });
    } finally {
      setClarifyLoading(false);
    }
  };

  // Keep editedItems in sync with parsedData changes
  const parsedData = po.parsedData;

  const confirmMutation = useMutation({
    mutationFn: async () => {
      // First save any edits
      const updatedParsed = { ...parsedData, items: editedItems };
      await apiRequest("PATCH", `/api/purchase-orders/${po.id}`, { parsedData: updatedParsed });
      // Then confirm
      const res = await apiRequest("POST", `/api/purchase-orders/${po.id}/confirm`, {});
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Added to pricing database",
        description: `${data.entriesAdded} line item${data.entriesAdded !== 1 ? "s" : ""} added to pricing history.`,
      });
      qc.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      onRefresh();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const reparseMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/purchase-orders/${po.id}/parse`, {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Re-parsing triggered", description: "Check back in a moment." });
      setTimeout(onRefresh, 3000);
    },
  });

  const updateItem = (idx: number, field: keyof ParsedItem, value: string | number) => {
    setEditedItems(prev => prev.map((item, i) =>
      i === idx ? { ...item, [field]: field === "amount" ? Number(value) : value } : item
    ));
  };

  const removeItem = (idx: number) => {
    setEditedItems(prev => prev.filter((_, i) => i !== idx));
  };

  const addItem = () => {
    setEditedItems(prev => [...prev, { trade: "general", description: "", amount: 0, unit: "lump sum" }]);
  };

  const isProcessing = po.status === "pending" || po.status === "ocr_complete";
  const canConfirm = po.status === "parsed" && editedItems.some(i => i.amount > 0);

  return (
    <Card className={`transition-all ${po.status === "confirmed" ? "opacity-70" : ""}`}>
      <CardContent className="pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm truncate">{po.filename}</span>
              {statusBadge(po.status)}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Uploaded {new Date(po.createdAt).toLocaleDateString()}
              {po.notes && ` · ${po.notes}`}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {po.fileUrl && !po.fileUrl.startsWith("data:") && (
              <a href={po.fileUrl} target="_blank" rel="noopener noreferrer">
                <Button variant="ghost" size="icon" className="h-7 w-7">
                  <ExternalLink className="w-3.5 h-3.5" />
                </Button>
              </a>
            )}
            {(po.status === "parsed" || po.status === "error") && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => reparseMutation.mutate()}
                title="Re-run AI parse"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${reparseMutation.isPending ? "animate-spin" : ""}`} />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        {/* Processing state */}
        {isProcessing && (
          <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            {po.status === "pending" ? "Reading document..." : "Extracting pricing data..."}
            <Button variant="ghost" size="sm" className="h-6 text-xs ml-auto" onClick={onRefresh}>
              <RefreshCw className="w-3 h-3 mr-1" />Refresh
            </Button>
          </div>
        )}

        {/* Expanded content */}
        {expanded && !isProcessing && (
          <div className="mt-4 space-y-4">
            {/* Meta info */}
            {parsedData && (parsedData.subName || parsedData.date || parsedData.projectAddress) && (
              <div className="bg-muted/40 rounded-md p-3 text-sm grid grid-cols-1 md:grid-cols-3 gap-2">
                {parsedData.subName && (
                  <div><span className="text-muted-foreground text-xs">Sub / Company</span><p className="font-medium">{parsedData.subName}</p></div>
                )}
                {parsedData.date && (
                  <div><span className="text-muted-foreground text-xs">Invoice Date</span><p className="font-medium">{parsedData.date}</p></div>
                )}
                {parsedData.projectAddress && (
                  <div><span className="text-muted-foreground text-xs">Project Address</span><p className="font-medium">{parsedData.projectAddress}</p></div>
                )}
              </div>
            )}

            {/* Confidence badge */}
            {parsedData?.confidence && (
              <div className="flex items-center gap-2">
                {confidenceBadge(parsedData.confidence)}
                {parsedData.error && (
                  <span className="text-xs text-muted-foreground">{parsedData.error}</span>
                )}
              </div>
            )}

            {/* Clarifying questions */}
            {po.status === "parsed" && questions.length > 0 && !clarifySubmitted && (
              <div className="border border-amber-500/30 bg-amber-500/5 rounded-md p-3 space-y-3">
                <p className="text-xs font-medium text-amber-600">A few quick questions to improve pricing accuracy:</p>
                {questions.map((q, i) => (
                  <div key={i} className="space-y-1">
                    <label className="text-xs text-foreground">{q.question}</label>
                    <input
                      className="w-full text-xs border rounded px-2 py-1 bg-background"
                      placeholder="Your answer..."
                      value={clarifyAnswers[q.itemIndex] || ""}
                      onChange={e => setClarifyAnswers(prev => ({ ...prev, [q.itemIndex]: e.target.value }))}
                    />
                  </div>
                ))}
                <div className="flex gap-2">
                  <button
                    onClick={handleClarifySubmit}
                    disabled={clarifyLoading || Object.keys(clarifyAnswers).length === 0}
                    className="text-xs px-3 py-1 bg-amber-500 text-white rounded font-medium disabled:opacity-50"
                  >
                    {clarifyLoading ? "Updating..." : "Refine Pricing"}
                  </button>
                  <button
                    onClick={() => setClarifySubmitted(true)}
                    className="text-xs px-3 py-1 border rounded text-muted-foreground"
                  >
                    Skip
                  </button>
                </div>
              </div>
            )}

            {/* Editable line items table */}
            {po.status === "parsed" && editedItems.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Line Items — edit to correct any OCR errors
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-xs text-muted-foreground">
                        <th className="text-left pb-2 pr-2 font-medium w-32">Trade</th>
                        <th className="text-left pb-2 pr-2 font-medium">Description</th>
                        <th className="text-right pb-2 pr-2 font-medium w-28">Amount ($)</th>
                        <th className="text-left pb-2 pr-2 font-medium w-32">Unit</th>
                        <th className="w-8"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {editedItems.map((item, idx) => (
                        <tr key={idx}>
                          <td className="py-1.5 pr-2">
                            <Select
                              value={item.trade}
                              onValueChange={v => updateItem(idx, "trade", v)}
                            >
                              <SelectTrigger className="h-7 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {TRADE_OPTIONS.map(t => (
                                  <SelectItem key={t} value={t} className="text-xs capitalize">{t}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="py-1.5 pr-2">
                            <Input
                              className="h-7 text-xs"
                              value={item.description}
                              onChange={e => updateItem(idx, "description", e.target.value)}
                            />
                          </td>
                          <td className="py-1.5 pr-2">
                            <Input
                              className="h-7 text-xs text-right"
                              type="number"
                              min="0"
                              step="0.01"
                              value={item.amount}
                              onChange={e => updateItem(idx, "amount", e.target.value)}
                            />
                          </td>
                          <td className="py-1.5 pr-2">
                            <Select
                              value={item.unit}
                              onValueChange={v => updateItem(idx, "unit", v)}
                            >
                              <SelectTrigger className="h-7 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {UNIT_OPTIONS.map(u => (
                                  <SelectItem key={u} value={u} className="text-xs">{u}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="py-1.5">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-muted-foreground hover:text-destructive"
                              onClick={() => removeItem(idx)}
                            >
                              ×
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {parsedData?.total && (
                      <tfoot>
                        <tr className="border-t">
                          <td colSpan={2} className="pt-2 text-xs text-muted-foreground text-right pr-2">Invoice Total</td>
                          <td className="pt-2 text-right pr-2 font-semibold text-sm">
                            ${parsedData.total.toLocaleString()}
                          </td>
                          <td colSpan={2}></td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-7 gap-1"
                  onClick={addItem}
                >
                  + Add line item
                </Button>
              </div>
            )}

            {/* Confirmed view */}
            {po.status === "confirmed" && parsedData?.items && parsedData.items.length > 0 && (
              <div className="text-sm text-muted-foreground space-y-1">
                {parsedData.items.map((item, i) => (
                  <div key={i} className="flex justify-between gap-2">
                    <span className="capitalize">{item.trade} — {item.description}</span>
                    <span className="font-medium">${item.amount?.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Raw OCR toggle */}
            {po.rawOcrText && (
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1 text-muted-foreground"
                  onClick={() => setShowOcr(!showOcr)}
                >
                  {showOcr ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  {showOcr ? "Hide" : "Show"} raw OCR text
                </Button>
                {showOcr && (
                  <pre className="mt-2 text-xs bg-muted/50 rounded p-3 overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto font-mono">
                    {po.rawOcrText}
                  </pre>
                )}
              </div>
            )}

            {/* Confirm button */}
            {canConfirm && (
              <Button
                onClick={() => confirmMutation.mutate()}
                disabled={confirmMutation.isPending}
                className="w-full gap-2 bg-green-600 hover:bg-green-700 text-white"
              >
                {confirmMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle className="w-4 h-4" />
                )}
                Confirm & Add to Pricing Database
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function PurchaseOrdersPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [uploadState, setUploadState] = useState<"idle" | "uploading" | "processing">("idle");

  const { data: pos, isLoading, refetch } = useQuery<PurchaseOrder[]>({
    queryKey: ["/api/purchase-orders"],
  });

  const handleUpload = async (file: File, estimateId?: string, notes?: string) => {
    setUploadState("uploading");
    try {
      const formData = new FormData();
      formData.append("file", file);
      if (estimateId) formData.append("estimateId", estimateId);
      if (notes) formData.append("notes", notes);

      const token = getToken();
      const apiBase = import.meta.env.PROD ? "https://onedegree-estimator.onrender.com" : "";
      const res = await fetch(`${apiBase}/api/purchase-orders/upload`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(err.error || "Upload failed");
      }

      setUploadState("processing");
      toast({
        title: "Uploaded successfully",
        description: "Reading document and extracting pricing data...",
      });
      qc.invalidateQueries({ queryKey: ["/api/purchase-orders"] });

      // Poll for completion
      setTimeout(() => {
        refetch();
        setUploadState("idle");
      }, 4000);
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
      setUploadState("idle");
    }
  };

  const pendingCount = pos?.filter(p => p.status === "pending" || p.status === "ocr_complete").length || 0;
  const reviewCount = pos?.filter(p => p.status === "parsed").length || 0;
  const confirmedCount = pos?.filter(p => p.status === "confirmed").length || 0;

  return (
    <AdminLayout>
      <div className="p-6 max-w-4xl mx-auto space-y-6 pb-16">
        {/* Header */}
        <div>
          <h1 className="font-display text-xl font-bold">Purchase Orders & Sub Invoices</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Upload invoices and purchase orders — OCR extracts pricing data into the AI reference database.
          </p>
        </div>

        {/* Stats */}
        {pos && pos.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            <Card className="p-3">
              <p className="text-2xl font-bold">{pendingCount}</p>
              <p className="text-xs text-muted-foreground">Processing</p>
            </Card>
            <Card className="p-3">
              <p className="text-2xl font-bold text-amber-500">{reviewCount}</p>
              <p className="text-xs text-muted-foreground">Awaiting Review</p>
            </Card>
            <Card className="p-3">
              <p className="text-2xl font-bold text-green-500">{confirmedCount}</p>
              <p className="text-xs text-muted-foreground">Confirmed</p>
            </Card>
          </div>
        )}

        {/* Upload zone */}
        {uploadState === "idle" ? (
          <UploadZone onUpload={handleUpload} />
        ) : (
          <Card>
            <CardContent className="pt-6 pb-6">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <div className="text-center">
                  <p className="font-medium text-sm">
                    {uploadState === "uploading" ? "Uploading file..." : "Reading document..."}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {uploadState === "processing"
                      ? "OCR and AI extraction in progress. This may take 30–60 seconds."
                      : "Uploading to secure storage..."}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* PO list */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Uploaded Documents ({pos?.length || 0})
            </h2>
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => refetch()}>
              <RefreshCw className="w-3 h-3" />Refresh
            </Button>
          </div>

          {isLoading && (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full" />)}
            </div>
          )}

          {!isLoading && pos?.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center">
                <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No documents uploaded yet.</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Upload a sub invoice or purchase order above to get started.
                </p>
              </CardContent>
            </Card>
          )}

          {pos?.map(po => (
            <PORow key={po.id} po={po} onRefresh={() => refetch()} />
          ))}
        </div>
      </div>
    </AdminLayout>
  );
}
