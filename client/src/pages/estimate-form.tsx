import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { AdminLayout } from "@/components/admin-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Trash2, Save, Send, ArrowUp, ArrowDown, Sparkles, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatCurrency } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PHASE_GROUPS, GROUPED_PHASES } from "@shared/schema";
import type { SalesRep, Estimate, LineItem, PaymentMilestone } from "@shared/schema";
import { useState, useEffect, useMemo } from "react";

interface LineItemForm {
  phaseGroup: string;
  customPhaseLabel: string;
  scopeDescription: string;
  subCost: number;
  isGrouped: boolean;
  sortOrder: number;
}

interface MilestoneForm {
  milestoneName: string;
  amount: number;
  sortOrder: number;
}

type EstimateDetail = Estimate & {
  salesRep?: SalesRep;
  lineItems: LineItem[];
  milestones: PaymentMilestone[];
};

export default function EstimateForm() {
  const params = useParams<{ id: string }>();
  const isEditing = !!params.id;
  const [, navigate] = useLocation();
  const { toast } = useToast();

  // Form state
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [projectAddress, setProjectAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("CA");
  const [zip, setZip] = useState("");
  const [salesRepId, setSalesRepId] = useState<number>(0);
  const [notesInternal, setNotesInternal] = useState("");
  const [permitRequired, setPermitRequired] = useState(false);
  const [items, setItems] = useState<LineItemForm[]>([]);
  const [milestones, setMilestones] = useState<MilestoneForm[]>([]);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiOpen, setAiOpen] = useState(false);

  const { data: salesReps } = useQuery<SalesRep[]>({ queryKey: ["/api/sales-reps"] });

  // AI generation mutation
  const aiMutation = useMutation({
    mutationFn: async (prompt: string) => {
      const res = await apiRequest("POST", "/api/ai/generate-estimate", { prompt });
      return res.json();
    },
    onSuccess: (data: any) => {
      // Populate all form fields from AI response
      if (data.clientName) setClientName(data.clientName);
      if (data.clientEmail) setClientEmail(data.clientEmail);
      if (data.clientPhone) setClientPhone(data.clientPhone);
      if (data.projectAddress) setProjectAddress(data.projectAddress);
      if (data.city) setCity(data.city);
      if (data.state) setState(data.state);
      if (data.zip) setZip(data.zip);
      if (typeof data.permitRequired === "boolean") setPermitRequired(data.permitRequired);
      if (data.notesInternal) setNotesInternal(data.notesInternal);

      if (data.lineItems && Array.isArray(data.lineItems)) {
        setItems(data.lineItems.map((li: any, idx: number) => ({
          phaseGroup: li.phaseGroup || "other",
          customPhaseLabel: li.customPhaseLabel || "",
          scopeDescription: li.scopeDescription || "",
          subCost: li.subCost || 0,
          isGrouped: li.isGrouped || false,
          sortOrder: idx,
        })));
      }

      if (data.milestones && Array.isArray(data.milestones)) {
        setMilestones(data.milestones.map((m: any, idx: number) => ({
          milestoneName: m.milestoneName || "",
          amount: m.amount || 0,
          sortOrder: idx,
        })));
      }

      toast({ title: "Estimate generated", description: "Review and adjust before sending." });
    },
    onError: (err: any) => {
      toast({ title: "AI Error", description: err.message || "Failed to generate estimate", variant: "destructive" });
    },
  });

  const { data: existingEstimate, isLoading: loadingEstimate } = useQuery<EstimateDetail>({
    queryKey: ["/api/estimates", params.id],
    enabled: isEditing,
  });

  // Populate form when editing
  useEffect(() => {
    if (existingEstimate) {
      setClientName(existingEstimate.clientName);
      setClientEmail(existingEstimate.clientEmail);
      setClientPhone(existingEstimate.clientPhone);
      setProjectAddress(existingEstimate.projectAddress);
      setCity(existingEstimate.city);
      setState(existingEstimate.state);
      setZip(existingEstimate.zip);
      setSalesRepId(existingEstimate.salesRepId);
      setNotesInternal(existingEstimate.notesInternal || "");
      setPermitRequired(existingEstimate.permitRequired);
      setItems(
        existingEstimate.lineItems
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map(li => ({
            phaseGroup: li.phaseGroup,
            customPhaseLabel: (li as any).customPhaseLabel || "",
            scopeDescription: li.scopeDescription,
            subCost: li.subCost,
            isGrouped: li.isGrouped,
            sortOrder: li.sortOrder,
          }))
      );
      setMilestones(
        existingEstimate.milestones
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map(m => ({
            milestoneName: m.milestoneName,
            amount: m.amount,
            sortOrder: m.sortOrder,
          }))
      );
    }
  }, [existingEstimate]);

  // Set default sales rep
  useEffect(() => {
    if (salesReps?.length && !salesRepId) {
      setSalesRepId(salesReps[0].id);
    }
  }, [salesReps, salesRepId]);

  // Auto-calculations
  const calculations = useMemo(() => {
    const totalSubCost = items.reduce((sum, i) => sum + (i.subCost || 0), 0);
    const subtotal = totalSubCost * 2;
    const allowance = Math.round(subtotal * 0.03 * 100) / 100;
    const total = Math.round((subtotal + allowance) * 100) / 100;
    const deposit = Math.min(1000, Math.round(total * 0.1 * 100) / 100);
    const milestoneTotal = milestones.reduce((sum, m) => sum + (m.amount || 0), 0);
    return { totalSubCost, subtotal, allowance, total, deposit, milestoneTotal };
  }, [items, milestones]);

  // Line item helpers
  const addLineItem = () => {
    setItems(prev => [
      ...prev,
      {
        phaseGroup: "general_conditions",
        customPhaseLabel: "",
        scopeDescription: "",
        subCost: 0,
        isGrouped: false,
        sortOrder: prev.length,
      },
    ]);
  };

  const removeLineItem = (index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index).map((item, i) => ({ ...item, sortOrder: i })));
  };

  const updateLineItem = (index: number, field: keyof LineItemForm, value: any) => {
    setItems(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      // Auto-set isGrouped for grouped phases
      if (field === "phaseGroup") {
        updated[index].isGrouped = GROUPED_PHASES.includes(value);
      }
      return updated;
    });
  };

  const moveLineItem = (index: number, direction: "up" | "down") => {
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= items.length) return;
    setItems(prev => {
      const arr = [...prev];
      [arr[index], arr[newIndex]] = [arr[newIndex], arr[index]];
      return arr.map((item, i) => ({ ...item, sortOrder: i }));
    });
  };

  // Milestone helpers
  const addMilestone = () => {
    setMilestones(prev => [
      ...prev,
      { milestoneName: "", amount: 0, sortOrder: prev.length },
    ]);
  };

  const removeMilestone = (index: number) => {
    setMilestones(prev => prev.filter((_, i) => i !== index).map((m, i) => ({ ...m, sortOrder: i })));
  };

  const updateMilestone = (index: number, field: keyof MilestoneForm, value: any) => {
    setMilestones(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const generateDefaultMilestones = () => {
    const total = calculations.total;
    if (total <= 0) return;
    const deposit = calculations.deposit;
    const remaining = total - deposit;
    setMilestones([
      { milestoneName: "Deposit upon acceptance", amount: deposit, sortOrder: 0 },
      { milestoneName: "Completion of Demo & Framing", amount: Math.round(remaining * 0.35 * 100) / 100, sortOrder: 1 },
      { milestoneName: "Completion of MEP Rough-In", amount: Math.round(remaining * 0.25 * 100) / 100, sortOrder: 2 },
      { milestoneName: "Completion of Drywall & Paint", amount: Math.round(remaining * 0.2 * 100) / 100, sortOrder: 3 },
      { milestoneName: "Final Completion & Walkthrough", amount: Math.round(remaining * 0.2 * 100) / 100, sortOrder: 4 },
    ]);
  };

  // Save mutations
  const createMutation = useMutation({
    mutationFn: async (status: string) => {
      const body = {
        clientName, clientEmail, clientPhone,
        projectAddress, city, state, zip,
        salesRepId, notesInternal, permitRequired,
        status,
        lineItems: items,
        milestones,
      };
      const res = await apiRequest("POST", "/api/estimates", body);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
      toast({ title: "Estimate created", description: `${data.estimateNumber} saved successfully.` });
      navigate(`/estimates/${data.id}`);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (status: string) => {
      const body = {
        clientName, clientEmail, clientPhone,
        projectAddress, city, state, zip,
        salesRepId, notesInternal, permitRequired,
        status,
        lineItems: items,
        milestones,
      };
      const res = await apiRequest("PUT", `/api/estimates/${params.id}`, body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/estimates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/estimates", params.id] });
      toast({ title: "Estimate updated" });
      navigate(`/estimates/${params.id}`);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleSave = (status: string) => {
    if (!clientName || !clientEmail || !projectAddress) {
      toast({ title: "Missing fields", description: "Please fill in client name, email, and project address.", variant: "destructive" });
      return;
    }
    if (isEditing) {
      updateMutation.mutate(status);
    } else {
      createMutation.mutate(status);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  if (isEditing && loadingEstimate) {
    return (
      <AdminLayout>
        <div className="p-6 max-w-5xl mx-auto space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-64 w-full" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-6 pb-24">
        {/* Header */}
        <div data-testid="form-header">
          <h1 className="font-display text-xl font-bold" data-testid="page-title">
            {isEditing ? "Edit Estimate" : "New Estimate"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isEditing ? `Editing ${existingEstimate?.estimateNumber}` : "Create a new construction estimate"}
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column - form fields */}
          <div className="lg:col-span-2 space-y-6">
            {/* AI Assistant */}
            {!isEditing && (
              <Collapsible open={aiOpen} onOpenChange={setAiOpen}>
                <Card className="border-primary/30 bg-gradient-to-r from-primary/5 to-transparent" data-testid="section-ai-assistant">
                  <CollapsibleTrigger asChild>
                    <CardHeader className="pb-4 cursor-pointer flex flex-row items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-primary" />
                        <CardTitle className="text-sm font-semibold">AI Assistant</CardTitle>
                      </div>
                      {aiOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                    </CardHeader>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <CardContent className="space-y-3 pt-0">
                      <p className="text-xs text-muted-foreground">
                        Describe the project and AI will auto-populate the entire estimate form.
                      </p>
                      <Textarea
                        value={aiPrompt}
                        onChange={e => setAiPrompt(e.target.value)}
                        placeholder="Describe the project... e.g., 'Full bathroom remodel at 456 Oak Ave, Encino for Sarah Chen. Demo, new layout, full MEP, tile, paint.'"
                        rows={3}
                        data-testid="input-ai-prompt"
                      />
                      <Button
                        onClick={() => aiMutation.mutate(aiPrompt)}
                        disabled={!aiPrompt.trim() || aiMutation.isPending}
                        className="gap-2"
                        data-testid="button-generate-estimate"
                      >
                        {aiMutation.isPending ? (
                          <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</>
                        ) : (
                          <><Sparkles className="w-4 h-4" /> Generate Estimate</>
                        )}
                      </Button>
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            )}

            {/* Client Info */}
            <Card data-testid="section-client-info">
              <CardHeader className="pb-4">
                <CardTitle className="text-sm font-semibold">Client Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="clientName">Client Name *</Label>
                    <Input id="clientName" value={clientName} onChange={e => setClientName(e.target.value)} placeholder="John Smith" data-testid="input-client-name" />
                  </div>
                  <div>
                    <Label htmlFor="clientEmail">Email *</Label>
                    <Input id="clientEmail" type="email" value={clientEmail} onChange={e => setClientEmail(e.target.value)} placeholder="john@example.com" data-testid="input-client-email" />
                  </div>
                  <div>
                    <Label htmlFor="clientPhone">Phone</Label>
                    <Input id="clientPhone" value={clientPhone} onChange={e => setClientPhone(e.target.value)} placeholder="(555) 123-4567" data-testid="input-client-phone" />
                  </div>
                  <div>
                    <Label htmlFor="salesRep">Sales Rep</Label>
                    <Select value={String(salesRepId)} onValueChange={v => setSalesRepId(Number(v))}>
                      <SelectTrigger data-testid="select-sales-rep">
                        <SelectValue placeholder="Select rep..." />
                      </SelectTrigger>
                      <SelectContent>
                        {salesReps?.map(rep => (
                          <SelectItem key={rep.id} value={String(rep.id)}>{rep.name} — {rep.title}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Separator />
                <div>
                  <Label htmlFor="projectAddress">Project Address *</Label>
                  <Input id="projectAddress" value={projectAddress} onChange={e => setProjectAddress(e.target.value)} placeholder="123 Main St" data-testid="input-project-address" />
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label htmlFor="city">City</Label>
                    <Input id="city" value={city} onChange={e => setCity(e.target.value)} placeholder="Los Angeles" data-testid="input-city" />
                  </div>
                  <div>
                    <Label htmlFor="state">State</Label>
                    <Input id="state" value={state} onChange={e => setState(e.target.value)} placeholder="CA" data-testid="input-state" />
                  </div>
                  <div>
                    <Label htmlFor="zip">ZIP</Label>
                    <Input id="zip" value={zip} onChange={e => setZip(e.target.value)} placeholder="90001" data-testid="input-zip" />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Line Items */}
            <Card data-testid="section-line-items">
              <CardHeader className="pb-4 flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-semibold">Line Items</CardTitle>
                <Button variant="outline" size="sm" onClick={addLineItem} className="gap-1" data-testid="button-add-line-item">
                  <Plus className="w-3 h-3" /> Add Item
                </Button>
              </CardHeader>
              <CardContent>
                {items.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8" data-testid="empty-line-items">
                    No line items yet. Click "Add Item" to begin.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {items.map((item, idx) => (
                      <div key={idx} className="border rounded-lg p-4 space-y-3" data-testid={`line-item-${idx}`}>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground font-mono w-6">#{idx + 1}</span>
                          <Select value={item.phaseGroup} onValueChange={v => updateLineItem(idx, "phaseGroup", v)}>
                            <SelectTrigger className="flex-1" data-testid={`select-phase-${idx}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {PHASE_GROUPS.map(pg => (
                                <SelectItem key={pg.value} value={pg.value}>{pg.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => moveLineItem(idx, "up")} disabled={idx === 0} data-testid={`move-up-${idx}`}>
                              <ArrowUp className="w-3 h-3" />
                            </Button>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => moveLineItem(idx, "down")} disabled={idx === items.length - 1} data-testid={`move-down-${idx}`}>
                              <ArrowDown className="w-3 h-3" />
                            </Button>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive" onClick={() => removeLineItem(idx)} data-testid={`remove-item-${idx}`}>
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                        {item.phaseGroup === "other" && (
                          <Input
                            placeholder="Custom phase name..."
                            value={item.customPhaseLabel}
                            onChange={e => updateLineItem(idx, "customPhaseLabel", e.target.value)}
                            className="text-sm"
                            data-testid={`input-custom-phase-${idx}`}
                          />
                        )}
                        <Textarea
                          placeholder="Scope description (client-facing)..."
                          value={item.scopeDescription}
                          onChange={e => updateLineItem(idx, "scopeDescription", e.target.value)}
                          rows={2}
                          data-testid={`input-scope-${idx}`}
                        />
                        <div className="flex items-center gap-4">
                          <div className="flex-1">
                            <Label className="text-xs">Sub Cost (internal)</Label>
                            <Input
                              type="number"
                              value={item.subCost || ""}
                              onChange={e => updateLineItem(idx, "subCost", parseFloat(e.target.value) || 0)}
                              placeholder="0.00"
                              data-testid={`input-sub-cost-${idx}`}
                            />
                          </div>
                          <div className="flex-1">
                            <Label className="text-xs">Client Price (auto)</Label>
                            <Input
                              value={formatCurrency(item.subCost * 2)}
                              readOnly
                              className="bg-muted"
                              data-testid={`text-client-price-${idx}`}
                            />
                          </div>
                          {GROUPED_PHASES.includes(item.phaseGroup) && (
                            <div className="text-xs text-muted-foreground">
                              <span className="bg-primary/10 text-primary px-2 py-1 rounded">Grouped</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Payment Schedule */}
            <Card data-testid="section-payment-schedule">
              <CardHeader className="pb-4 flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-semibold">Payment Schedule</CardTitle>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={generateDefaultMilestones} data-testid="button-generate-milestones">
                    Auto-Generate
                  </Button>
                  <Button variant="outline" size="sm" onClick={addMilestone} className="gap-1" data-testid="button-add-milestone">
                    <Plus className="w-3 h-3" /> Add
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {milestones.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6" data-testid="empty-milestones">
                    No milestones. Click "Auto-Generate" for a standard payment schedule.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {milestones.map((m, idx) => (
                      <div key={idx} className="flex items-center gap-3" data-testid={`milestone-${idx}`}>
                        <Input
                          className="flex-1"
                          value={m.milestoneName}
                          onChange={e => updateMilestone(idx, "milestoneName", e.target.value)}
                          placeholder="Milestone name"
                          data-testid={`input-milestone-name-${idx}`}
                        />
                        <Input
                          type="number"
                          className="w-32"
                          value={m.amount || ""}
                          onChange={e => updateMilestone(idx, "amount", parseFloat(e.target.value) || 0)}
                          placeholder="0.00"
                          data-testid={`input-milestone-amount-${idx}`}
                        />
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive" onClick={() => removeMilestone(idx)} data-testid={`remove-milestone-${idx}`}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    ))}
                    <div className="flex justify-between items-center pt-2 border-t text-sm">
                      <span className="text-muted-foreground">Milestone Total</span>
                      <span className={`font-semibold ${Math.abs(calculations.milestoneTotal - calculations.total) > 0.01 ? "text-destructive" : "text-foreground"}`} data-testid="text-milestone-total">
                        {formatCurrency(calculations.milestoneTotal)}
                        {Math.abs(calculations.milestoneTotal - calculations.total) > 0.01 && (
                          <span className="text-xs ml-2">(should be {formatCurrency(calculations.total)})</span>
                        )}
                      </span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Internal Notes & Permit */}
            <Card data-testid="section-options">
              <CardHeader className="pb-4">
                <CardTitle className="text-sm font-semibold">Options</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3">
                  <Switch checked={permitRequired} onCheckedChange={setPermitRequired} data-testid="switch-permit" />
                  <Label>Permit Required</Label>
                </div>
                <div>
                  <Label htmlFor="notesInternal">Internal Notes (never shown to client)</Label>
                  <Textarea
                    id="notesInternal"
                    value={notesInternal}
                    onChange={e => setNotesInternal(e.target.value)}
                    placeholder="Notes for the team..."
                    rows={3}
                    data-testid="input-notes-internal"
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right column - calculations panel */}
          <div className="space-y-6">
            <Card className="sticky top-6" data-testid="section-calculations">
              <CardHeader className="pb-4">
                <CardTitle className="text-sm font-semibold">Estimate Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Internal Cost</span>
                  <span className="font-mono" data-testid="text-total-sub-cost">{formatCurrency(calculations.totalSubCost)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal (100% markup)</span>
                  <span className="font-mono" data-testid="text-subtotal">{formatCurrency(calculations.subtotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">3% Allowance</span>
                  <span className="font-mono" data-testid="text-allowance">{formatCurrency(calculations.allowance)}</span>
                </div>
                <Separator />
                <div className="flex justify-between font-semibold">
                  <span>Total Client Price</span>
                  <span className="font-mono text-primary" data-testid="text-total-client-price">{formatCurrency(calculations.total)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Deposit Required</span>
                  <span className="font-mono" data-testid="text-deposit">{formatCurrency(calculations.deposit)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Margin</span>
                  <span className="font-mono">{formatCurrency(calculations.subtotal - calculations.totalSubCost)}</span>
                </div>

                <Separator />

                <div className="space-y-2 pt-2">
                  <Button
                    className="w-full gap-2"
                    variant="outline"
                    onClick={() => handleSave("draft")}
                    disabled={isPending}
                    data-testid="button-save-draft"
                  >
                    <Save className="w-4 h-4" />
                    Save Draft
                  </Button>
                  <Button
                    className="w-full gap-2"
                    onClick={() => handleSave("sent")}
                    disabled={isPending}
                    data-testid="button-send"
                  >
                    <Send className="w-4 h-4" />
                    Send to Client
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
