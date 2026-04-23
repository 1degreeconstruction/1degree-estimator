import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { useAuth } from "@/hooks/use-auth";
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
import { Plus, Trash2, Save, Send, ArrowUp, ArrowDown, Sparkles, ChevronDown, ChevronUp, Loader2, MessageSquare, Layers, Link, Upload, Search, FileText, CheckCircle2, Clock, AlertCircle, Calendar as CalendarIcon } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCurrency } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PHASE_GROUPS, GROUPED_PHASES } from "@shared/schema";
import type { SalesRep, Estimate, LineItem, PaymentMilestone } from "@shared/schema";
import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { AddressAutocomplete } from "@/components/address-autocomplete";

interface BreakdownForm {
  tradeName: string;
  subCost: number;
  notes: string;
}

interface LineItemForm {
  phaseGroup: string;
  customPhaseLabel: string;
  scopeDescription: string;
  subCost: number;
  isGrouped: boolean;
  sortOrder: number;
  breakdowns: BreakdownForm[];
}

const DEFAULT_BREAKDOWNS: Record<string, BreakdownForm[]> = {
  mep: [
    { tradeName: "Plumbing", subCost: 0, notes: "" },
    { tradeName: "Electrical", subCost: 0, notes: "" },
    { tradeName: "HVAC", subCost: 0, notes: "" },
  ],
  insulation_drywall_paint: [
    { tradeName: "Insulation", subCost: 0, notes: "" },
    { tradeName: "Drywall", subCost: 0, notes: "" },
    { tradeName: "Paint", subCost: 0, notes: "" },
  ],
  tile_finish_carpentry: [
    { tradeName: "Tile/Stone", subCost: 0, notes: "" },
    { tradeName: "Cabinetry", subCost: 0, notes: "" },
    { tradeName: "Finish Carpentry", subCost: 0, notes: "" },
  ],
};

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
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const dirtyRef = useRef(false);
  const setDirty = (v: boolean) => { dirtyRef.current = v; setHasUnsavedChanges(v); };

  // Warn on browser back / tab close when there are unsaved changes
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) { e.preventDefault(); e.returnValue = ""; }
    };
    // Intercept in-app hash navigation (sidebar clicks, back button)
    const hashChange = (e: HashChangeEvent) => {
      if (dirtyRef.current) {
        if (!window.confirm("You have unsaved changes. Leave without saving?")) {
          e.preventDefault();
          // Restore the hash to stay on the form
          window.history.pushState(null, "", e.oldURL);
        }
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("hashchange", hashChange);
    return () => { window.removeEventListener("beforeunload", beforeUnload); window.removeEventListener("hashchange", hashChange); };
  }, []);

  // Mark dirty on any form interaction
  const markDirty = () => { if (!dirtyRef.current) setDirty(true); };

  // Track form changes via a capturing listener on the form container
  useEffect(() => {
    const handler = () => markDirty();
    const container = document.querySelector('[data-testid="estimate-form"]');
    if (container) {
      container.addEventListener("input", handler, true);
      container.addEventListener("change", handler, true);
      return () => { container.removeEventListener("input", handler, true); container.removeEventListener("change", handler, true); };
    }
  });

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
  const [markupRate, setMarkupRate] = useState(100);
  const [apparentDiscountType, setApparentDiscountType] = useState<string>("");
  const [apparentDiscountValue, setApparentDiscountValue] = useState(0);
  const [realDiscountType, setRealDiscountType] = useState<string>("");
  const [realDiscountValue, setRealDiscountValue] = useState(0);
  const [showContactSuggestions, setShowContactSuggestions] = useState(false);
  const [collapsedItems, setCollapsedItems] = useState<Set<number>>(new Set());
  const toggleCollapse = (idx: number) => setCollapsedItems(prev => { const n = new Set(prev); n.has(idx) ? n.delete(idx) : n.add(idx); return n; });
  const [showMeetings, setShowMeetings] = useState(false);
  const [selectedMeetingRaw, setSelectedMeetingRaw] = useState<any>(null); // raw calendar event for AI context

  // Calendar events
  const { data: calendarEvents = [], isLoading: calendarLoading } = useQuery<any[]>({
    queryKey: ["/api/calendar/recent"],
    enabled: showMeetings,
  });

  // Contact autocomplete
  interface ContactSuggestion { id: number; name: string; email: string | null; phone: string | null; address: string | null; city: string | null; state: string | null; zip: string | null; }
  const { data: allContacts = [] } = useQuery<ContactSuggestion[]>({ queryKey: ["/api/contacts"] });
  const contactSuggestions = clientName.length >= 1
    ? allContacts.filter(c => c.name.toLowerCase().includes(clientName.toLowerCase())).slice(0, 6)
    : [];
  const [items, setItems] = useState<LineItemForm[]>([]);
  const [milestones, setMilestones] = useState<MilestoneForm[]>([]);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [pricingChatOpen, setPricingChatOpen] = useState(false);
  const [pricingMessages, setPricingMessages] = useState<Array<{role: string, content: string}>>([]);
  const [pricingInput, setPricingInput] = useState("");
  const [pricingLoading, setPricingLoading] = useState(false);
  const pricingEndRef = useRef<HTMLDivElement>(null);

  // Purchase Orders Reference state
  const [poRefOpen, setPoRefOpen] = useState(false);
  const [poSearchQuery, setPoSearchQuery] = useState("");
  const [poUploadFile, setPoUploadFile] = useState<File | null>(null);
  const [poUploading, setPoUploading] = useState(false);
  const [poLinking, setPoLinking] = useState<number | null>(null);

  // AI Breakdown state: track which line item index is loading
  const [aiBreakdownLoading, setAiBreakdownLoading] = useState<number | null>(null);

  // Market rates cache: tradeName -> rates
  const [marketRatesCache, setMarketRatesCache] = useState<Record<string, { low: number; mid: number; high: number; unit: string } | null>>({});

  // Fetch market rate for a trade name (memoized per trade)
  const fetchMarketRate = useCallback(async (tradeName: string) => {
    if (!tradeName || marketRatesCache.hasOwnProperty(tradeName)) return;
    // Pre-populate with null to avoid duplicate requests
    setMarketRatesCache(prev => ({ ...prev, [tradeName]: null }));
    try {
      const res = await apiRequest("GET", `/api/market-rates?trade=${encodeURIComponent(tradeName)}`);
      const data = await res.json();
      setMarketRatesCache(prev => ({ ...prev, [tradeName]: data.rates || null }));
    } catch {
      // non-fatal
    }
  }, [marketRatesCache]);

  // AI Breakdown handler
  const handleAiBreakdown = useCallback(async (idx: number) => {
    const item = items[idx];
    if (!item || item.subCost <= 0) {
      toast({ title: "Set a sub cost first", description: "Enter the total sub cost before generating a breakdown.", variant: "destructive" });
      return;
    }
    setAiBreakdownLoading(idx);
    try {
      const res = await apiRequest("POST", "/api/ai/breakdown", {
        phaseGroup: item.phaseGroup,
        totalSubCost: item.subCost,
        scopeDescription: item.scopeDescription,
        city,
      });
      const data = await res.json();
      if (data.breakdowns && Array.isArray(data.breakdowns)) {
        setItems(prev => {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], breakdowns: data.breakdowns };
          return updated;
        });
        toast({ title: "AI Breakdown generated", description: `${data.breakdowns.length} trades populated.` });
      } else {
        toast({ title: "AI Breakdown failed", description: data.error || "Unexpected response", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "AI Breakdown failed", description: err.message || "Network error", variant: "destructive" });
    } finally {
      setAiBreakdownLoading(null);
    }
  }, [items, city, toast]);

  const handlePricingChat = useCallback(async () => {
    if (!pricingInput.trim() || pricingLoading) return;
    const userMsg = { role: "user", content: pricingInput.trim() };
    const newMessages = [...pricingMessages, userMsg];
    setPricingMessages(newMessages);
    setPricingInput("");
    setPricingLoading(true);
    setTimeout(() => pricingEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    try {
      const res = await apiRequest("POST", "/api/pricing-chat", {
        message: userMsg.content,
        conversationHistory: newMessages.slice(-10),
        estimateId: params.id ? parseInt(params.id) : undefined,
      });
      const data = await res.json();
      setPricingMessages(prev => [...prev, { role: "assistant", content: data.reply }]);
      setTimeout(() => pricingEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    } catch {
      setPricingMessages(prev => [...prev, { role: "assistant", content: "Error connecting to pricing assistant." }]);
    } finally {
      setPricingLoading(false);
    }
  }, [pricingInput, pricingMessages, pricingLoading]);
  const [projectInclusions, setProjectInclusions] = useState("");
  const [projectExclusions, setProjectExclusions] = useState("");

  const { data: salesReps } = useQuery<SalesRep[]>({ queryKey: ["/api/sales-reps"] });

  // PO Reference queries
  interface PurchaseOrderData {
    id: number;
    estimateId?: number | null;
    filename: string;
    fileUrl: string;
    status: string;
    parsedData?: {
      subName?: string;
      total?: number;
      items?: Array<{ trade?: string; description?: string; amount?: number }>;
    } | null;
    createdAt?: string;
    projectAddress?: string;
  }

  const { data: thisEstimatePOs, refetch: refetchThisPOs } = useQuery<PurchaseOrderData[]>({
    queryKey: ["/api/purchase-orders", params.id],
    queryFn: async () => {
      if (!params.id) return [];
      const res = await apiRequest("GET", `/api/purchase-orders?estimateId=${params.id}`);
      return res.json();
    },
    enabled: isEditing && poRefOpen,
  });

  const { data: searchedPOs, refetch: refetchSearch } = useQuery<PurchaseOrderData[]>({
    queryKey: ["/api/purchase-orders/search", poSearchQuery],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/purchase-orders/search?q=${encodeURIComponent(poSearchQuery)}`);
      return res.json();
    },
    enabled: poRefOpen,
  });

  const handlePOUpload = useCallback(async () => {
    if (!poUploadFile || !params.id || poUploading) return;
    setPoUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", poUploadFile);
      formData.append("estimateId", params.id);
      const res = await fetch("/api/purchase-orders/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      toast({ title: "PO uploaded", description: "Processing OCR and parsing..." });
      setPoUploadFile(null);
      refetchThisPOs();
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setPoUploading(false);
    }
  }, [poUploadFile, params.id, poUploading, toast, refetchThisPOs]);

  const handleLinkPO = useCallback(async (poId: number) => {
    if (!params.id || poLinking === poId) return;
    setPoLinking(poId);
    try {
      const res = await apiRequest("POST", `/api/purchase-orders/${poId}/link`, {
        estimateId: parseInt(params.id),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Link failed");
      }
      toast({ title: "PO linked", description: "Purchase order is now linked to this estimate." });
      refetchThisPOs();
      refetchSearch();
    } catch (err: any) {
      toast({ title: "Link failed", description: err.message, variant: "destructive" });
    } finally {
      setPoLinking(null);
    }
  }, [params.id, poLinking, toast, refetchThisPOs, refetchSearch]);

  // AI generation mutation
  const aiMutation = useMutation({
    mutationFn: async (prompt: string) => {
      const body: Record<string, any> = { prompt };
      if (isEditing && params.id) {
        body.estimateId = params.id;
      }
      // Include current form data + calendar context for AI cross-checking
      body.currentFormData = { clientName, clientEmail, clientPhone, projectAddress, city, state, zip };
      if (selectedMeetingRaw) {
        body.calendarEvent = {
          summary: selectedMeetingRaw.summary,
          location: selectedMeetingRaw.location,
          description: selectedMeetingRaw.description,
          attendees: selectedMeetingRaw.attendees,
        };
      }
      const res = await apiRequest("POST", "/api/ai/generate-estimate", body);
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
      if (data.projectInclusions !== undefined) setProjectInclusions(data.projectInclusions || "");
      if (data.projectExclusions !== undefined) setProjectExclusions(data.projectExclusions || "");

      if (data.lineItems && Array.isArray(data.lineItems)) {
        setItems(data.lineItems.map((li: any, idx: number) => {
          const isGrouped = li.isGrouped || false;
          const phaseGroup = li.phaseGroup || "other";
          let breakdowns: BreakdownForm[] = [];
          if (isGrouped) {
            if (li.breakdowns && Array.isArray(li.breakdowns) && li.breakdowns.length > 0) {
              breakdowns = li.breakdowns.map((bd: any) => ({
                tradeName: bd.tradeName || "",
                subCost: bd.subCost || 0,
                notes: bd.notes || "",
              }));
            } else if (DEFAULT_BREAKDOWNS[phaseGroup]) {
              // Fallback to defaults with zero costs if AI didn't provide breakdowns
              breakdowns = DEFAULT_BREAKDOWNS[phaseGroup].map(bd => ({ ...bd }));
            }
          }
          return {
            phaseGroup,
            customPhaseLabel: li.customPhaseLabel || "",
            scopeDescription: li.scopeDescription || "",
            subCost: li.subCost || 0,
            isGrouped,
            sortOrder: idx,
            breakdowns,
          };
        }));
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
      setProjectInclusions((existingEstimate as any).projectInclusions || "");
      setProjectExclusions((existingEstimate as any).projectExclusions || "");
      setPermitRequired(existingEstimate.permitRequired);
      setMarkupRate((existingEstimate as any).markupRate ?? 100);
      setApparentDiscountType((existingEstimate as any).apparentDiscountType || "");
      setApparentDiscountValue((existingEstimate as any).apparentDiscountValue || 0);
      setRealDiscountType((existingEstimate as any).realDiscountType || "");
      setRealDiscountValue((existingEstimate as any).realDiscountValue || 0);
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
            breakdowns: (() => {
              const existingBds = (li as any).breakdowns || [];
              if (existingBds.length > 0) {
                return existingBds.map((bd: any) => ({
                  tradeName: bd.tradeName || "",
                  subCost: bd.subCost || 0,
                  notes: bd.notes || "",
                }));
              }
              // Fallback to default breakdown rows for known grouped phases
              if (li.isGrouped && DEFAULT_BREAKDOWNS[li.phaseGroup]) {
                return DEFAULT_BREAKDOWNS[li.phaseGroup].map(bd => ({ ...bd }));
              }
              return [];
            })(),
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
  const { user } = useAuth();
  useEffect(() => {
    if (salesReps?.length && !salesRepId) {
      // Auto-select the rep matching the signed-in user's email
      const match = user?.email ? salesReps.find(r => r.email.toLowerCase() === user.email.toLowerCase()) : null;
      setSalesRepId(match ? match.id : salesReps[0].id);
    }
  }, [salesReps, salesRepId, user]);

  // Auto-calculations
  const calculations = useMemo(() => {
    const totalSubCost = items.reduce((sum, i) => sum + (i.subCost || 0), 0);
    const markupMultiplier = 1 + (markupRate || 100) / 100;
    const subtotal = Math.round(totalSubCost * markupMultiplier * 100) / 100;
    const allowance = Math.round(subtotal * 0.03 * 100) / 100;
    const preDiscountTotal = Math.round((subtotal + allowance) * 100) / 100;

    // Apparent discount: inflates the "original" price shown to client, actual total stays the same
    let apparentOriginal = preDiscountTotal;
    let apparentSavings = 0;
    if (apparentDiscountType === "percent" && apparentDiscountValue > 0) {
      // Client sees a higher "original" price, discounted to the real total
      apparentOriginal = Math.round(preDiscountTotal / (1 - apparentDiscountValue / 100) * 100) / 100;
      apparentSavings = Math.round((apparentOriginal - preDiscountTotal) * 100) / 100;
    } else if (apparentDiscountType === "dollar" && apparentDiscountValue > 0) {
      apparentOriginal = preDiscountTotal + apparentDiscountValue;
      apparentSavings = apparentDiscountValue;
    }

    // Real discount: actually reduces the total (and your profit)
    let realSavings = 0;
    let total = preDiscountTotal;
    if (realDiscountType === "percent" && realDiscountValue > 0) {
      realSavings = Math.round(preDiscountTotal * (realDiscountValue / 100) * 100) / 100;
      total = Math.round((preDiscountTotal - realSavings) * 100) / 100;
    } else if (realDiscountType === "dollar" && realDiscountValue > 0) {
      realSavings = realDiscountValue;
      total = Math.round((preDiscountTotal - realSavings) * 100) / 100;
    }

    // If apparent discount is active, the client sees: apparentOriginal → total (after both discounts)
    // Total shown to client = total (after real discount)
    // "You save" shown to client = apparentSavings + realSavings
    const clientVisibleOriginal = apparentSavings > 0 ? apparentOriginal : (realSavings > 0 ? preDiscountTotal : 0);
    const clientVisibleSavings = apparentSavings + realSavings;

    const deposit = Math.min(1000, Math.round(total * 0.1 * 100) / 100);
    const milestoneTotal = milestones.reduce((sum, m) => sum + (m.amount || 0), 0);
    const margin = subtotal - totalSubCost - realSavings;

    return {
      totalSubCost, subtotal, allowance, preDiscountTotal, total, deposit,
      milestoneTotal, markupMultiplier, apparentOriginal, apparentSavings,
      realSavings, clientVisibleOriginal, clientVisibleSavings, margin,
    };
  }, [items, milestones, markupRate, apparentDiscountType, apparentDiscountValue, realDiscountType, realDiscountValue]);

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
        breakdowns: [],
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
      // Auto-set isGrouped for grouped phases and auto-populate default breakdowns
      if (field === "phaseGroup") {
        const isGrouped = GROUPED_PHASES.includes(value);
        updated[index].isGrouped = isGrouped;
        if (isGrouped && DEFAULT_BREAKDOWNS[value]) {
          // Only auto-populate if no breakdowns yet
          if (updated[index].breakdowns.length === 0) {
            updated[index].breakdowns = DEFAULT_BREAKDOWNS[value].map(bd => ({ ...bd }));
          }
        } else if (!isGrouped) {
          updated[index].breakdowns = [];
        }
      }
      // When isGrouped changes, manage breakdowns
      if (field === "isGrouped") {
        if (value && DEFAULT_BREAKDOWNS[updated[index].phaseGroup] && updated[index].breakdowns.length === 0) {
          updated[index].breakdowns = DEFAULT_BREAKDOWNS[updated[index].phaseGroup].map(bd => ({ ...bd }));
        } else if (!value) {
          updated[index].breakdowns = [];
        }
      }
      return updated;
    });
  };

  const updateBreakdown = (itemIndex: number, bdIndex: number, field: keyof BreakdownForm, value: any) => {
    setItems(prev => {
      const updated = [...prev];
      const breakdowns = [...updated[itemIndex].breakdowns];
      breakdowns[bdIndex] = { ...breakdowns[bdIndex], [field]: value };
      updated[itemIndex] = { ...updated[itemIndex], breakdowns };
      // Auto-recalculate subCost from breakdown totals
      const total = breakdowns.reduce((sum, bd) => sum + (bd.subCost || 0), 0);
      updated[itemIndex] = { ...updated[itemIndex], breakdowns, subCost: total };
      return updated;
    });
  };

  const addBreakdown = (itemIndex: number) => {
    setItems(prev => {
      const updated = [...prev];
      const breakdowns = [...updated[itemIndex].breakdowns, { tradeName: "", subCost: 0, notes: "" }];
      updated[itemIndex] = { ...updated[itemIndex], breakdowns };
      return updated;
    });
  };

  const removeBreakdown = (itemIndex: number, bdIndex: number) => {
    setItems(prev => {
      const updated = [...prev];
      const breakdowns = updated[itemIndex].breakdowns.filter((_, i) => i !== bdIndex);
      updated[itemIndex] = { ...updated[itemIndex], breakdowns };
      // Recalculate subCost
      const total = breakdowns.reduce((sum, bd) => sum + (bd.subCost || 0), 0);
      updated[itemIndex] = { ...updated[itemIndex], breakdowns, subCost: total };
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

  // AI recalculate milestones
  const [aiRecalcLoading, setAiRecalcLoading] = useState(false);
  const aiRecalcMilestones = async () => {
    setAiRecalcLoading(true);
    try {
      const res = await apiRequest("POST", "/api/ai/recalc-milestones", {
        totalClientPrice: calculations.total,
        milestones: milestones.map(m => ({ name: m.milestoneName, amount: m.amount })),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      const data = await res.json();
      if (data.milestones) {
        setMilestones(data.milestones.map((m: any, i: number) => ({
          milestoneName: m.name || m.milestoneName || "",
          amount: m.amount || 0,
          sortOrder: i,
        })));
      }
    } catch (err: any) {
      toast({ title: "Recalculate failed", description: err.message, variant: "destructive" });
    }
    setAiRecalcLoading(false);
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

  const moveMilestone = (index: number, direction: "up" | "down") => {
    setMilestones(prev => {
      const arr = [...prev];
      const target = direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= arr.length) return arr;
      [arr[index], arr[target]] = [arr[target], arr[index]];
      return arr.map((m, i) => ({ ...m, sortOrder: i }));
    });
  };

  const updateMilestone = (index: number, field: keyof MilestoneForm, value: any) => {
    setMilestones(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  // Track which milestones the user has manually edited
  const [userEditedMilestones, setUserEditedMilestones] = useState<Set<string>>(new Set());
  const [milestonePercentMode, setMilestonePercentMode] = useState<Set<number>>(new Set());

  const markMilestoneEdited = (index: number) => {
    const name = milestones[index]?.milestoneName;
    if (name) setUserEditedMilestones(prev => new Set(prev).add(name));
  };

  const isMilestoneEdited = (index: number) => {
    return userEditedMilestones.has(milestones[index]?.milestoneName || "");
  };

  const generateDefaultMilestones = () => {
    const total = calculations.total;
    if (total <= 0) return;
    const deposit = Math.min(1000, Math.round(total * 0.10));
    const retentionTarget = Math.round(total * 0.10 * 100) / 100;

    // Build phase list from current line items
    const phaseNames: string[] = [];
    items.forEach(item => {
      if (item.phaseGroup === "mep") {
        // Break MEP into individual trades from breakdowns
        if (item.breakdowns && item.breakdowns.length > 0) {
          item.breakdowns.forEach(bd => {
            if (bd.tradeName) phaseNames.push(`Completion of ${bd.tradeName}`);
          });
        } else {
          phaseNames.push("Completion of Plumbing Rough-In", "Completion of Electrical Rough-In", "Completion of HVAC");
        }
      } else if (item.phaseGroup === "insulation_drywall_paint") {
        if (item.breakdowns && item.breakdowns.length > 0) {
          item.breakdowns.forEach(bd => {
            if (bd.tradeName) phaseNames.push(`Completion of ${bd.tradeName}`);
          });
        } else {
          phaseNames.push("Completion of Insulation", "Completion of Drywall", "Completion of Paint");
        }
      } else if (item.phaseGroup === "tile_finish_carpentry") {
        if (item.breakdowns && item.breakdowns.length > 0) {
          item.breakdowns.forEach(bd => {
            if (bd.tradeName) phaseNames.push(`Completion of ${bd.tradeName}`);
          });
        } else {
          phaseNames.push("Completion of Tile & Stone", "Completion of Finish Carpentry");
        }
      } else if (item.phaseGroup === "general_conditions") {
        // Skip — covered by deposit
      } else if (item.phaseGroup === "permit_design" || item.phaseGroup === "planning") {
        // Skip — covered by deposit
      } else {
        const label = item.customPhaseLabel || PHASE_GROUPS.find(p => p.value === item.phaseGroup)?.label || item.phaseGroup;
        phaseNames.push(`Completion of ${label}`);
      }
    });

    if (phaseNames.length === 0) {
      phaseNames.push("Completion of Work");
    }

    // If milestones already exist, preserve user-edited ones
    if (milestones.length > 0 && userEditedMilestones.size > 0) {
      // Keep user-edited milestones, regenerate the rest
      const userEditedTotal = milestones
        .filter((_, i) => isMilestoneEdited(i))
        .reduce((sum, m) => sum + m.amount, 0);
      const remainingBudget = total - deposit - retentionTarget - userEditedTotal;
      const unedited = milestones.filter((_, i) => !isMilestoneEdited(i) && i !== 0 && i !== milestones.length - 1);
      
      // Build new milestones: deposit + user-edited (highlighted) + new phases + retention
      const newMilestones: MilestoneForm[] = [
        { milestoneName: "Deposit upon acceptance", amount: deposit, sortOrder: 0 },
      ];
      let sortIdx = 1;

      // Determine which phases need new milestones (exclude ones already covered by user-edited)
      const editedNames = milestones.filter((_, i) => isMilestoneEdited(i)).map(m => m.milestoneName);
      const newPhases = phaseNames.filter(p => !editedNames.includes(p));

      // Re-add user-edited milestones
      milestones.forEach((m, i) => {
        if (isMilestoneEdited(i) && i !== 0) {
          newMilestones.push({ ...m, sortOrder: sortIdx++ });
        }
      });

      // Distribute remaining budget across new phases
      const perPhase = newPhases.length > 0 ? remainingBudget / newPhases.length : 0;
      newPhases.forEach(name => {
        const rounded = perPhase > 5000 ? Math.round(perPhase / 500) * 500 : Math.round(perPhase / 100) * 100;
        newMilestones.push({ milestoneName: name, amount: Math.max(rounded, 0), sortOrder: sortIdx++ });
      });

      // Retention absorbs the remainder
      const usedSoFar = newMilestones.reduce((sum, m) => sum + m.amount, 0);
      newMilestones.push({ milestoneName: "Final Walkthrough & Project Closeout (10% Retention)", amount: Math.round((total - usedSoFar) * 100) / 100, sortOrder: sortIdx });

      setMilestones(newMilestones);
      return;
    }

    // Fresh generation — no user edits
    const remaining = total - deposit - retentionTarget;
    const perPhase = phaseNames.length > 0 ? remaining / phaseNames.length : remaining;

    const newMilestones: MilestoneForm[] = [
      { milestoneName: "Deposit upon acceptance", amount: deposit, sortOrder: 0 },
    ];

    let usedSoFar = deposit;
    phaseNames.forEach((name, i) => {
      // Top-heavy: earlier phases get slightly more
      const weight = 1 + (phaseNames.length - i) * 0.05;
      const raw = perPhase * weight;
      const rounded = raw > 5000 ? Math.round(raw / 500) * 500 : Math.round(raw / 100) * 100;
      newMilestones.push({ milestoneName: name, amount: rounded, sortOrder: i + 1 });
      usedSoFar += rounded;
    });

    // Retention absorbs remainder
    const retention = Math.round((total - usedSoFar) * 100) / 100;
    newMilestones.push({ milestoneName: "Final Walkthrough & Project Closeout (10% Retention)", amount: retention, sortOrder: phaseNames.length + 1 });

    setMilestones(newMilestones);
    setUserEditedMilestones(new Set()); // Reset edit tracking
  };

  // Save mutations
  const createMutation = useMutation({
    mutationFn: async (status: string) => {
      const body = {
        clientName, clientEmail, clientPhone,
        projectAddress, city, state, zip,
        salesRepId, notesInternal, permitRequired,
        projectInclusions, projectExclusions,
        markupRate,
        apparentDiscountType: apparentDiscountType || null,
        apparentDiscountValue: apparentDiscountValue || null,
        realDiscountType: realDiscountType || null,
        realDiscountValue: realDiscountValue || null,
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
      setDirty(false);
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
        projectInclusions, projectExclusions,
        markupRate,
        apparentDiscountType: apparentDiscountType || null,
        apparentDiscountValue: apparentDiscountValue || null,
        realDiscountType: realDiscountType || null,
        realDiscountValue: realDiscountValue || null,
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
      setDirty(false);
      navigate(`/estimates/${params.id}`);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleAddressSelect = useCallback(
    (components: { address: string; city: string; state: string; zip: string }) => {
      setProjectAddress(components.address);
      setCity(components.city);
      setState(components.state);
      setZip(components.zip);
    },
    []
  );

  const handleSave = (status: string) => {
    // Only validate required fields when sending to client
    if (status === "sent") {
      if (!clientName || !projectAddress) {
        toast({
          title: "Missing fields",
          description: "Client name and project address are required to send to client.",
          variant: "destructive",
        });
        return;
      }
    }
    // Drafts can be saved with any (including empty) fields
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
      <div className="p-6 max-w-5xl mx-auto space-y-6 pb-24" data-testid="estimate-form">
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
            {(
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
                        className="min-h-[60px] overflow-hidden resize-none"
                          style={{ height: "auto" }}
                          onInput={e => { const t = e.currentTarget; t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; }}
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

            {/* Recent Meetings Picker */}
            {!isEditing && (
              <Card data-testid="section-calendar">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <CalendarIcon className="w-4 h-4 text-orange-400" />
                      From Recent Meeting
                    </CardTitle>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowMeetings(p => !p)}>
                      {showMeetings ? "Hide" : "Show Meetings"}
                    </Button>
                  </div>
                </CardHeader>
                {showMeetings && (
                  <CardContent className="pt-0">
                    {calendarLoading ? (
                      <p className="text-xs text-muted-foreground">Loading calendar...</p>
                    ) : calendarEvents.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No recent meetings found. You may need to sign out and back in to grant calendar access.</p>
                    ) : (
                      <div className="space-y-1.5 max-h-48 overflow-y-auto">
                        {calendarEvents.map((evt: any) => (
                          <button
                            key={evt.id}
                            type="button"
                            className="w-full text-left px-3 py-2 rounded-md text-sm hover:bg-accent transition-colors border border-transparent hover:border-border"
                            onClick={async () => {
                              const hasData = clientName || clientEmail || clientPhone || projectAddress;
                              if (hasData && !window.confirm("Replace current client info with this meeting's details?")) return;

                              // Quick fill from raw data first
                              const attendee = evt.attendees?.[0];
                              setClientName(attendee?.name || evt.summary || "");
                              setClientEmail(attendee?.email || "");
                              setClientPhone(evt.phone || "");
                              setProjectAddress(evt.location || "");
                              setShowContactSuggestions(false);
                              setShowMeetings(false);
                              setSelectedMeetingRaw(evt);

                              // Then run AI parser for better extraction
                              try {
                                const res = await apiRequest("POST", "/api/calendar/parse-event", { event: evt });
                                if (res.ok) {
                                  const parsed = await res.json();
                                  if (parsed.clientName) setClientName(parsed.clientName);
                                  if (parsed.clientEmail) setClientEmail(parsed.clientEmail);
                                  if (parsed.clientPhone) setClientPhone(parsed.clientPhone);
                                  if (parsed.projectAddress) setProjectAddress(parsed.projectAddress);
                                  if (parsed.city) setCity(parsed.city);
                                  if (parsed.state) setState(parsed.state);
                                  if (parsed.zip) setZip(parsed.zip);
                                }
                              } catch { /* AI parse failed, keep hardcoded fill */ }
                            }}
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-medium truncate">{evt.summary}</span>
                              <span className="text-[10px] text-muted-foreground shrink-0 ml-2">
                                {new Date(evt.start).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                              {evt.attendees?.[0]?.name && <span>{evt.attendees[0].name}</span>}
                              {evt.attendees?.[0]?.email && <span>{evt.attendees[0].email}</span>}
                              {evt.location && <span className="truncate">{evt.location}</span>}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            )}

            {/* Client Info */}
            <Card data-testid="section-client-info">
              <CardHeader className="pb-4">
                <CardTitle className="text-sm font-semibold">Client Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="relative">
                    <Label htmlFor="clientName">Client Name</Label>
                    <Input
                      id="clientName"
                      value={clientName}
                      onChange={e => { setClientName(e.target.value); setShowContactSuggestions(true); }}
                      onFocus={() => clientName.length >= 1 && setShowContactSuggestions(true)}
                      placeholder="John Smith"
                      autoComplete="off"
                      data-testid="input-client-name"
                    />
                    {showContactSuggestions && clientName.length >= 1 && contactSuggestions.length > 0 && (
                      <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg max-h-48 overflow-y-auto">
                        {contactSuggestions.map(c => (
                          <button
                            key={c.id}
                            type="button"
                            className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors"
                            onClick={() => {
                              setClientName(c.name);
                              if (c.email) setClientEmail(c.email);
                              if (c.phone) setClientPhone(c.phone);
                              if (c.address) setProjectAddress(c.address);
                              if (c.city) setCity(c.city);
                              if (c.state) setState(c.state);
                              if (c.zip) setZip(c.zip);
                              setShowContactSuggestions(false);
                            }}
                          >
                            <div className="font-medium">{c.name}</div>
                            {c.email && <div className="text-xs text-muted-foreground">{c.email}</div>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="clientEmail">Email</Label>
                    <Input id="clientEmail" type="email" value={clientEmail} onChange={e => setClientEmail(e.target.value)} placeholder="john@example.com" data-testid="input-client-email" />
                  </div>
                  <div>
                    <Label htmlFor="clientPhone">Phone</Label>
                    <Input id="clientPhone" value={clientPhone} onChange={e => setClientPhone(e.target.value)} placeholder="(555) 123-4567" data-testid="input-client-phone" />
                  </div>
                  <div>
                    <Label htmlFor="salesRep">Sales Rep</Label>
                    <Select value={salesRepId ? String(salesRepId) : undefined} onValueChange={v => setSalesRepId(Number(v))}>
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
                  <Label htmlFor="projectAddress">Project Address</Label>
                  <AddressAutocomplete
                    id="projectAddress"
                    value={projectAddress}
                    onChange={setProjectAddress}
                    onAddressSelect={handleAddressSelect}
                    placeholder="123 Main St"
                    data-testid="input-project-address"
                  />
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
                          <button type="button" onClick={() => toggleCollapse(idx)} className="text-muted-foreground hover:text-foreground transition-colors">
                            {collapsedItems.has(idx) ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                          </button>
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
                          {/* Collapsed summary */}
                          {collapsedItems.has(idx) && (
                            <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                              {formatCurrency(item.subCost)} sub
                            </span>
                          )}
                        </div>
                        {!collapsedItems.has(idx) && item.phaseGroup === "other" && (
                          <Input
                            placeholder="Custom phase name..."
                            value={item.customPhaseLabel}
                            onChange={e => updateLineItem(idx, "customPhaseLabel", e.target.value)}
                            className="text-sm"
                            data-testid={`input-custom-phase-${idx}`}
                          />
                        )}
                        {!collapsedItems.has(idx) && <Textarea
                          placeholder="Scope description (client-facing)..."
                          value={item.scopeDescription}
                          onChange={e => updateLineItem(idx, "scopeDescription", e.target.value)}
                          className="min-h-[60px] overflow-hidden resize-none"
                          style={{ height: "auto" }}
                          onInput={e => { const t = e.currentTarget; t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; }}
                          ref={el => { if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; } }}
                          data-testid={`input-scope-${idx}`}
                        />}
                        {!collapsedItems.has(idx) && <div className="flex items-center gap-4">
                          <div className="flex-1">
                            <Label className="text-xs">Sub Cost (internal)</Label>
                            <Input
                              type="number"
                              value={item.subCost || ""}
                              onChange={e => !item.isGrouped && updateLineItem(idx, "subCost", parseFloat(e.target.value) || 0)}
                              readOnly={item.isGrouped}
                              placeholder={item.isGrouped ? "Auto-calculated from breakdown" : "0.00"}
                              className={item.isGrouped ? "bg-muted cursor-not-allowed" : ""}
                              data-testid={`input-sub-cost-${idx}`}
                            />
                          </div>
                          <div className="flex-1">
                            <Label className="text-xs">Client Price (auto)</Label>
                            <Input
                              value={formatCurrency(Math.round(item.subCost * calculations.markupMultiplier * 100) / 100)}
                              readOnly
                              className="bg-muted"
                              data-testid={`text-client-price-${idx}`}
                            />
                          </div>
                          {item.isGrouped && (
                            <div className="text-xs text-muted-foreground">
                              <span className="bg-primary/10 text-primary px-2 py-1 rounded flex items-center gap-1">
                                <Layers className="w-3 h-3" /> Grouped
                              </span>
                            </div>
                          )}
                        </div>}
                        {/* Trade Breakdown section for grouped items */}
                        {!collapsedItems.has(idx) && item.isGrouped && (
                          <div className="mt-2 border border-dashed border-primary/30 rounded-md p-3 bg-primary/5 space-y-2" data-testid={`breakdown-section-${idx}`}>
                            <div className="flex items-center justify-between gap-2">
                              <Label className="text-xs font-semibold text-primary flex items-center gap-1 shrink-0">
                                <Layers className="w-3 h-3" /> Trade Breakdown (Internal Only)
                              </Label>
                              <div className="flex items-center gap-1">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-6 px-2 text-xs gap-1 border-primary/40 text-primary hover:bg-primary/10"
                                  onClick={() => handleAiBreakdown(idx)}
                                  disabled={aiBreakdownLoading === idx}
                                  data-testid={`button-ai-breakdown-${idx}`}
                                >
                                  {aiBreakdownLoading === idx ? (
                                    <><Loader2 className="w-3 h-3 animate-spin" /> Generating...</>
                                  ) : (
                                    <><Sparkles className="w-3 h-3" /> AI Breakdown</>
                                  )}
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-xs"
                                  onClick={() => addBreakdown(idx)}
                                  data-testid={`button-add-breakdown-${idx}`}
                                >
                                  <Plus className="w-3 h-3 mr-1" /> Add Trade
                                </Button>
                              </div>
                            </div>
                            {item.breakdowns.map((bd, bdIdx) => {
                              // Trigger market rate fetch when tradeName is known
                              if (bd.tradeName && !marketRatesCache.hasOwnProperty(bd.tradeName)) {
                                fetchMarketRate(bd.tradeName);
                              }
                              const marketRate = bd.tradeName ? marketRatesCache[bd.tradeName] : undefined;
                              let marketBadge: React.ReactNode = null;
                              if (marketRate && bd.subCost > 0) {
                                if (bd.subCost < marketRate.low) {
                                  marketBadge = (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className="text-[10px] text-blue-500 whitespace-nowrap font-medium cursor-help">↓ Below</span>
                                      </TooltipTrigger>
                                      <TooltipContent side="top" className="max-w-[220px] text-xs">
                                        <p className="font-semibold mb-1">Below Market Range</p>
                                        <p>Your price: <span className="font-mono">${bd.subCost.toLocaleString()}</span></p>
                                        <p>Market low: <span className="font-mono">${marketRate.low.toLocaleString()}</span></p>
                                        <p>Market mid: <span className="font-mono">${marketRate.mid.toLocaleString()}</span></p>
                                        <p>Market high: <span className="font-mono">${marketRate.high.toLocaleString()}</span></p>
                                        <p className="text-muted-foreground mt-1">{marketRate.unit}</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  );
                                } else if (bd.subCost > marketRate.mid) {
                                  marketBadge = (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className="text-[10px] text-amber-500 whitespace-nowrap font-medium cursor-help">↑ Above</span>
                                      </TooltipTrigger>
                                      <TooltipContent side="top" className="max-w-[220px] text-xs">
                                        <p className="font-semibold mb-1">Above Market Range</p>
                                        <p>Your price: <span className="font-mono">${bd.subCost.toLocaleString()}</span></p>
                                        <p>Market low: <span className="font-mono">${marketRate.low.toLocaleString()}</span></p>
                                        <p>Market mid: <span className="font-mono">${marketRate.mid.toLocaleString()}</span></p>
                                        <p>Market high: <span className="font-mono">${marketRate.high.toLocaleString()}</span></p>
                                        <p className="text-muted-foreground mt-1">{marketRate.unit}</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  );
                                } else {
                                  marketBadge = (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className="text-[10px] text-green-600 whitespace-nowrap font-medium cursor-help">✓ Market</span>
                                      </TooltipTrigger>
                                      <TooltipContent side="top" className="max-w-[220px] text-xs">
                                        <p className="font-semibold mb-1">Within Market Range</p>
                                        <p>Your price: <span className="font-mono">${bd.subCost.toLocaleString()}</span></p>
                                        <p>Market low: <span className="font-mono">${marketRate.low.toLocaleString()}</span></p>
                                        <p>Market mid: <span className="font-mono">${marketRate.mid.toLocaleString()}</span></p>
                                        <p>Market high: <span className="font-mono">${marketRate.high.toLocaleString()}</span></p>
                                        <p className="text-muted-foreground mt-1">{marketRate.unit}</p>
                                      </TooltipContent>
                                    </Tooltip>
                                  );
                                }
                              }
                              return (
                              <div key={bdIdx} className="flex items-center gap-2" data-testid={`breakdown-row-${idx}-${bdIdx}`}>
                                <Input
                                  className="flex-1 h-7 text-xs"
                                  placeholder="Trade name"
                                  value={bd.tradeName}
                                  onChange={e => updateBreakdown(idx, bdIdx, "tradeName", e.target.value)}
                                  onBlur={e => e.target.value && fetchMarketRate(e.target.value)}
                                  data-testid={`input-breakdown-trade-${idx}-${bdIdx}`}
                                />
                                <div className="flex items-center gap-1">
                                  <Input
                                    type="number"
                                    className="w-24 h-7 text-xs"
                                    placeholder="0.00"
                                    value={bd.subCost || ""}
                                    onChange={e => updateBreakdown(idx, bdIdx, "subCost", parseFloat(e.target.value) || 0)}
                                    data-testid={`input-breakdown-cost-${idx}-${bdIdx}`}
                                  />
                                  {marketBadge}
                                </div>
                                <Input
                                  className="flex-1 h-7 text-xs"
                                  placeholder="Notes (optional)"
                                  value={bd.notes}
                                  onChange={e => updateBreakdown(idx, bdIdx, "notes", e.target.value)}
                                  data-testid={`input-breakdown-notes-${idx}-${bdIdx}`}
                                />
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0 text-destructive shrink-0"
                                  onClick={() => removeBreakdown(idx, bdIdx)}
                                  data-testid={`button-remove-breakdown-${idx}-${bdIdx}`}
                                >
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </div>
                              );
                            })}
                            <div className="flex justify-between items-center pt-1 border-t border-primary/20 text-xs">
                              <span className="text-muted-foreground">Breakdown Total</span>
                              <span className={`font-mono font-semibold ${
                                item.breakdowns.length > 0 && Math.abs(item.breakdowns.reduce((s, b) => s + b.subCost, 0) - item.subCost) > 0.01
                                  ? "text-destructive" : "text-foreground"
                              }`} data-testid={`text-breakdown-total-${idx}`}>
                                {formatCurrency(item.breakdowns.reduce((s, b) => s + b.subCost, 0))}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Project Inclusions & Exclusions */}
            <Card data-testid="section-project-inclusions-exclusions">
              <CardHeader className="pb-4">
                <CardTitle className="text-sm font-semibold">Project-Specific Inclusions &amp; Exclusions</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  AI-generated for this project. Editable — shown on the client page above the standard company terms.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="projectInclusions">Project Inclusions</Label>
                  <Textarea
                    id="projectInclusions"
                    value={projectInclusions}
                    onChange={e => setProjectInclusions(e.target.value)}
                    placeholder="• What is specifically included for this project..."
                    className="min-h-[60px] overflow-hidden resize-none"
                          style={{ height: "auto" }}
                          onInput={e => { const t = e.currentTarget; t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; }}
                    className="resize-y min-h-[100px]"
                    data-testid="input-project-inclusions"
                  />
                </div>
                <div>
                  <Label htmlFor="projectExclusions">Project Exclusions</Label>
                  <Textarea
                    id="projectExclusions"
                    value={projectExclusions}
                    onChange={e => setProjectExclusions(e.target.value)}
                    placeholder="• What is NOT included that the client might expect..."
                    className="min-h-[60px] overflow-hidden resize-none"
                          style={{ height: "auto" }}
                          onInput={e => { const t = e.currentTarget; t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; }}
                    className="resize-y min-h-[100px]"
                    data-testid="input-project-exclusions"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Discounts */}
            <Card data-testid="section-discounts">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">Discounts</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  {/* Apparent Discount */}
                  <div className="space-y-2 p-3 rounded-lg border border-dashed border-zinc-700">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-amber-400">Apparent Discount</span>
                      <span className="text-[10px] text-muted-foreground">(cosmetic only — no profit impact)</span>
                    </div>
                    <div className="flex gap-2">
                      <Select value={apparentDiscountType || "none"} onValueChange={v => setApparentDiscountType(v === "none" ? "" : v)}>
                        <SelectTrigger className="w-28 h-8 text-xs"><SelectValue placeholder="None" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          <SelectItem value="percent">Percent %</SelectItem>
                          <SelectItem value="dollar">Dollar $</SelectItem>
                        </SelectContent>
                      </Select>
                      {apparentDiscountType && (
                        <Input
                          type="number" min={0}
                          className="w-24 h-8 text-xs"
                          value={apparentDiscountValue || ""}
                          onChange={e => setApparentDiscountValue(parseFloat(e.target.value) || 0)}
                          placeholder={apparentDiscountType === "percent" ? "10" : "500"}
                        />
                      )}
                    </div>
                    {calculations.apparentSavings > 0 && (
                      <p className="text-xs text-amber-400">Client sees: <s className="text-muted-foreground">{formatCurrency(calculations.apparentOriginal)}</s> → {formatCurrency(calculations.preDiscountTotal)} (saves {formatCurrency(calculations.apparentSavings)})</p>
                    )}
                  </div>

                  {/* Real Discount */}
                  <div className="space-y-2 p-3 rounded-lg border border-dashed border-red-700/50">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-red-400">Real Discount</span>
                      <span className="text-[10px] text-muted-foreground">(reduces profit)</span>
                    </div>
                    <div className="flex gap-2">
                      <Select value={realDiscountType || "none"} onValueChange={v => setRealDiscountType(v === "none" ? "" : v)}>
                        <SelectTrigger className="w-28 h-8 text-xs"><SelectValue placeholder="None" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          <SelectItem value="percent">Percent %</SelectItem>
                          <SelectItem value="dollar">Dollar $</SelectItem>
                        </SelectContent>
                      </Select>
                      {realDiscountType && (
                        <Input
                          type="number" min={0}
                          className="w-24 h-8 text-xs"
                          value={realDiscountValue || ""}
                          onChange={e => setRealDiscountValue(parseFloat(e.target.value) || 0)}
                          placeholder={realDiscountType === "percent" ? "5" : "250"}
                        />
                      )}
                    </div>
                    {calculations.realSavings > 0 && (
                      <p className="text-xs text-red-400">Actual reduction: -{formatCurrency(calculations.realSavings)} (margin now {formatCurrency(calculations.margin)})</p>
                    )}
                  </div>
                </div>

                {calculations.clientVisibleSavings > 0 && (
                  <div className="text-xs bg-green-500/10 text-green-400 border border-green-500/20 rounded px-3 py-2">
                    Client will see: <s>{formatCurrency(calculations.clientVisibleOriginal)}</s> → <strong>{formatCurrency(calculations.total)}</strong> — "You save {formatCurrency(calculations.clientVisibleSavings)}"
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Payment Schedule */}
            <Card data-testid="section-payment-schedule">
              <CardHeader className="pb-4 flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-semibold">Payment Schedule</CardTitle>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={aiRecalcMilestones} disabled={aiRecalcLoading || milestones.length === 0} className="gap-1" data-testid="button-recalc-milestones">
                    <Sparkles className="w-3 h-3" />
                    {aiRecalcLoading ? "Calculating..." : "AI Recalculate"}
                  </Button>
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
                    {milestones.map((m, idx) => {
                      const isEdited = isMilestoneEdited(idx);
                      return (
                        <div key={idx} className={`flex items-center gap-2 rounded-md px-2 py-1 ${isEdited ? 'bg-amber-500/10 border border-amber-500/30' : ''}`} data-testid={`milestone-${idx}`}>
                          {/* Move buttons */}
                          <div className="flex flex-col gap-0.5">
                            <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => moveMilestone(idx, "up")} disabled={idx === 0}>
                              <ArrowUp className="w-3 h-3" />
                            </Button>
                            <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => moveMilestone(idx, "down")} disabled={idx === milestones.length - 1}>
                              <ArrowDown className="w-3 h-3" />
                            </Button>
                          </div>
                          <span className="text-xs text-muted-foreground w-5 text-center">{idx + 1}</span>
                          {isEdited && (
                            <button
                              type="button"
                              onClick={() => setUserEditedMilestones(prev => { const n = new Set(prev); n.delete(m.milestoneName); return n; })}
                              className="text-[9px] text-amber-500 font-medium whitespace-nowrap hover:text-amber-300 cursor-pointer"
                              title="Click to unlock so AI can adjust this milestone"
                            >
                              LOCKED ×
                            </button>
                          )}
                          <Input
                            className="flex-1"
                            value={m.milestoneName}
                            onChange={e => { markMilestoneEdited(idx); updateMilestone(idx, "milestoneName", e.target.value); }}
                            placeholder="Milestone name"
                            data-testid={`input-milestone-name-${idx}`}
                          />
                          <div className="flex items-center gap-1">
                            {milestonePercentMode.has(idx) ? (
                              <Input
                                type="number"
                                className="w-20"
                                value={calculations.total > 0 ? Math.round(m.amount / calculations.total * 10000) / 100 : ""}
                                onChange={e => { const pct = parseFloat(e.target.value) || 0; markMilestoneEdited(idx); updateMilestone(idx, "amount", Math.round(calculations.total * pct / 100 * 100) / 100); }}
                                placeholder="10"
                                data-testid={`input-milestone-pct-${idx}`}
                              />
                            ) : (
                              <Input
                                type="number"
                                className="w-28"
                                value={m.amount || ""}
                                onChange={e => { markMilestoneEdited(idx); updateMilestone(idx, "amount", parseFloat(e.target.value) || 0); }}
                                placeholder="0.00"
                                data-testid={`input-milestone-amount-${idx}`}
                              />
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className={`h-8 w-8 p-0 text-xs font-mono ${milestonePercentMode.has(idx) ? "text-primary bg-primary/10" : "text-muted-foreground"}`}
                              onClick={() => setMilestonePercentMode(prev => { const n = new Set(prev); n.has(idx) ? n.delete(idx) : n.add(idx); return n; })}
                              title="Toggle between $ and %"
                            >
                              %
                            </Button>
                          </div>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive" onClick={() => { const name = milestones[idx]?.milestoneName; setUserEditedMilestones(prev => { const n = new Set(prev); if (name) n.delete(name); return n; }); removeMilestone(idx); }} data-testid={`remove-milestone-${idx}`}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      );
                    })}
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

            {/* Purchase Orders & Vendor Pricing */}
            <Card data-testid="section-purchase-orders">
              <Collapsible open={poRefOpen} onOpenChange={setPoRefOpen}>
                <CollapsibleTrigger asChild>
                  <CardHeader className="pb-3 cursor-pointer flex flex-row items-center justify-between">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <FileText className="w-4 h-4" /> Purchase Orders &amp; Vendor Pricing
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      {thisEstimatePOs && thisEstimatePOs.length > 0 && (
                        <Badge variant="secondary" className="text-xs">{thisEstimatePOs.length}</Badge>
                      )}
                      {poRefOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0">
                    <Tabs defaultValue="this-estimate">
                      <TabsList className="w-full mb-3">
                        <TabsTrigger value="this-estimate" className="flex-1 text-xs">This Estimate</TabsTrigger>
                        <TabsTrigger value="other-projects" className="flex-1 text-xs">From Other Projects</TabsTrigger>
                      </TabsList>

                      {/* Tab 1: This Estimate */}
                      <TabsContent value="this-estimate" className="space-y-3 mt-0">
                        {!isEditing ? (
                          <p className="text-xs text-muted-foreground text-center py-4">Save this estimate first to upload POs.</p>
                        ) : (
                          <>
                            {/* Upload new PO */}
                            <div className="flex items-center gap-2">
                              <label className="flex-1 cursor-pointer">
                                <Input
                                  type="file"
                                  accept=".pdf,.jpg,.jpeg,.png"
                                  className="text-xs h-8"
                                  onChange={e => setPoUploadFile(e.target.files?.[0] || null)}
                                />
                              </label>
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1 h-8 text-xs whitespace-nowrap"
                                onClick={handlePOUpload}
                                disabled={!poUploadFile || poUploading}
                              >
                                {poUploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                                Upload PO
                              </Button>
                            </div>

                            {/* POs for this estimate */}
                            {!thisEstimatePOs ? (
                              <div className="space-y-2">
                                <Skeleton className="h-12 w-full" />
                                <Skeleton className="h-12 w-full" />
                              </div>
                            ) : thisEstimatePOs.length === 0 ? (
                              <p className="text-xs text-muted-foreground text-center py-3">No POs linked yet. Upload one above or link from other projects.</p>
                            ) : (
                              <div className="space-y-2">
                                {thisEstimatePOs.map(po => {
                                  const parsed = po.parsedData;
                                  const subName = parsed?.subName || po.filename;
                                  const total = parsed?.total ? formatCurrency(parsed.total) : "—";
                                  const date = po.createdAt ? new Date(po.createdAt).toLocaleDateString() : "";
                                  const StatusIcon = po.status === "confirmed" ? CheckCircle2 : po.status === "error" ? AlertCircle : Clock;
                                  const statusColor = po.status === "confirmed" ? "text-green-600" : po.status === "error" ? "text-destructive" : "text-amber-500";
                                  return (
                                    <div key={po.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs">
                                      <StatusIcon className={`w-3.5 h-3.5 flex-shrink-0 ${statusColor}`} />
                                      <div className="flex-1 min-w-0">
                                        <p className="font-medium truncate">{subName}</p>
                                        <p className="text-muted-foreground">{total} &middot; {po.status} &middot; {date}</p>
                                        {po.projectAddress && po.estimateId !== (params.id ? parseInt(params.id) : undefined) && (
                                          <p className="text-blue-500 text-[10px]">Linked from: {po.projectAddress}</p>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </>
                        )}
                      </TabsContent>

                      {/* Tab 2: From Other Projects */}
                      <TabsContent value="other-projects" className="space-y-3 mt-0">
                        <div className="relative">
                          <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-muted-foreground" />
                          <Input
                            placeholder="Search by trade, sub name, or address..."
                            value={poSearchQuery}
                            onChange={e => setPoSearchQuery(e.target.value)}
                            className="pl-8 text-xs h-8"
                          />
                        </div>

                        {!isEditing && (
                          <p className="text-xs text-muted-foreground text-center py-2">Save this estimate first to link POs.</p>
                        )}

                        {!searchedPOs ? (
                          <div className="space-y-2">
                            <Skeleton className="h-14 w-full" />
                            <Skeleton className="h-14 w-full" />
                          </div>
                        ) : searchedPOs.length === 0 ? (
                          <p className="text-xs text-muted-foreground text-center py-4">
                            No confirmed POs found{poSearchQuery ? ` for "${poSearchQuery}"` : ". Confirm POs in the Purchase Orders section first."}.
                          </p>
                        ) : (
                          <div className="space-y-2 max-h-64 overflow-y-auto">
                            {searchedPOs.map(po => {
                              const parsed = po.parsedData;
                              const subName = parsed?.subName || po.filename;
                              const total = parsed?.total ? formatCurrency(parsed.total) : "—";
                              const trades = [...new Set((parsed?.items || []).map((i) => i.trade).filter(Boolean))].slice(0, 3).join(", ");
                              const date = po.createdAt ? new Date(po.createdAt).toLocaleDateString() : "";
                              const alreadyLinked = thisEstimatePOs?.some(p => p.id === po.id);
                              return (
                                <div key={po.id} className="flex items-start gap-2 rounded-md border px-3 py-2 text-xs">
                                  <div className="flex-1 min-w-0">
                                    <p className="font-medium truncate">{subName}</p>
                                    {po.projectAddress && <p className="text-muted-foreground truncate">{po.projectAddress}</p>}
                                    <p className="text-muted-foreground">{total}{trades ? ` · ${trades}` : ""} &middot; {date}</p>
                                  </div>
                                  <Button
                                    size="sm"
                                    variant={alreadyLinked ? "secondary" : "outline"}
                                    className="h-7 text-xs gap-1 flex-shrink-0"
                                    onClick={() => !alreadyLinked && isEditing && handleLinkPO(po.id)}
                                    disabled={alreadyLinked || !isEditing || poLinking === po.id}
                                  >
                                    {poLinking === po.id ? (
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                    ) : alreadyLinked ? (
                                      <><CheckCircle2 className="w-3 h-3" /> Linked</>
                                    ) : (
                                      <><Link className="w-3 h-3" /> Link</>
                                    )}
                                  </Button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </TabsContent>
                    </Tabs>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
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
                    className="min-h-[60px] overflow-hidden resize-none"
                          style={{ height: "auto" }}
                          onInput={e => { const t = e.currentTarget; t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; }}
                    data-testid="input-notes-internal"
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right column - pricing assistant only */}
          <div className="space-y-6">

            {/* Pricing Assistant - inline chat */}
            <Card className="mt-4" data-testid="section-pricing-assistant">
              <Collapsible open={pricingChatOpen} onOpenChange={setPricingChatOpen}>
                <CollapsibleTrigger asChild>
                  <CardHeader className="pb-3 cursor-pointer flex flex-row items-center justify-between">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <MessageSquare className="w-4 h-4" /> Pricing Assistant
                    </CardTitle>
                    {pricingChatOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0">
                    <div className="h-[300px] overflow-y-auto mb-3 space-y-2 border rounded-md p-2 bg-background">
                      {pricingMessages.length === 0 && (
                        <p className="text-xs text-muted-foreground text-center py-8">Ask about pricing, costs, or past projects...</p>
                      )}
                      {pricingMessages.map((msg, i) => (
                        <div key={i} className={`text-xs p-2 rounded-md ${msg.role === 'user' ? 'bg-primary/10 ml-8 text-right' : 'bg-muted mr-8'}`}>
                          <p className="whitespace-pre-wrap">{msg.content}</p>
                        </div>
                      ))}
                      {pricingLoading && (
                        <div className="bg-muted mr-8 p-2 rounded-md">
                          <span className="text-xs text-muted-foreground">Thinking...</span>
                        </div>
                      )}
                      <div ref={pricingEndRef} />
                    </div>
                    <div className="flex gap-2">
                      <Textarea
                        value={pricingInput}
                        onChange={(e) => setPricingInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handlePricingChat();
                          }
                        }}
                        placeholder="e.g. What did we pay for demo on the last bathroom remodel?"
                        className="text-xs min-h-[36px] max-h-[72px]"
                        rows={1}
                      />
                      <Button size="sm" onClick={handlePricingChat} disabled={pricingLoading || !pricingInput.trim()}>
                        <Send className="w-3 h-3" />
                      </Button>
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          </div>
        </div>
      </div>

      {/* Fixed bottom banner — Estimate Summary */}
      <div className="fixed bottom-0 right-0 left-60 z-30 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 max-md:left-0" data-testid="section-calculations">
        <div className="max-w-7xl mx-auto px-4 py-2 space-y-1.5">
          {/* Row 1: Financials */}
          <div className="flex items-center gap-3 flex-wrap text-xs">
            <div className="flex items-center gap-1 whitespace-nowrap">
              <span className="text-muted-foreground">Cost:</span>
              <span className="font-mono font-medium" data-testid="text-total-sub-cost">{formatCurrency(calculations.totalSubCost)}</span>
            </div>
            <span className="text-muted-foreground/40">·</span>
            <div className="flex items-center gap-1 whitespace-nowrap">
              <span className="text-muted-foreground">Markup:</span>
              <Input
                type="number"
                min={0}
                max={500}
                step={5}
                value={markupRate}
                onChange={e => setMarkupRate(Math.max(0, parseFloat(e.target.value) || 0))}
                className="h-6 w-20 text-xs font-mono text-right inline-block px-2"
                data-testid="input-markup-rate"
              />
              <span className="text-muted-foreground">%</span>
            </div>
            <span className="text-muted-foreground/40">·</span>
            <div className="flex items-center gap-1 whitespace-nowrap">
              <span className="text-muted-foreground">Subtotal:</span>
              <span className="font-mono" data-testid="text-subtotal">{formatCurrency(calculations.subtotal)}</span>
            </div>
            <span className="text-muted-foreground/40">·</span>
            <div className="flex items-center gap-1 whitespace-nowrap">
              <span className="text-muted-foreground">Allowance:</span>
              <span className="font-mono" data-testid="text-allowance">{formatCurrency(calculations.allowance)}</span>
            </div>
            <span className="text-muted-foreground/40">·</span>
            <div className="flex items-center gap-1 whitespace-nowrap">
              <span className="text-muted-foreground">Margin:</span>
              <span className="font-mono">{formatCurrency(calculations.margin)}</span>
            </div>
          </div>
          {/* Row 2: Total + Discount + Actions */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Total:</span>
              <span className="text-sm font-mono font-bold text-primary" data-testid="text-total-client-price">{formatCurrency(calculations.total)}</span>
            </div>
            {calculations.clientVisibleSavings > 0 && (
              <div className="flex items-center gap-1.5 text-xs">
                <span className="font-mono line-through text-muted-foreground">{formatCurrency(calculations.clientVisibleOriginal)}</span>
                <span className="font-semibold text-green-500 bg-green-500/10 px-1.5 py-0.5 rounded text-[10px]">
                  -{formatCurrency(calculations.clientVisibleSavings)} ({calculations.clientVisibleOriginal > 0 ? (() => { const p = Math.round((calculations.clientVisibleSavings / calculations.clientVisibleOriginal) * 1000) / 10; return p % 1 === 0 ? p.toFixed(0) : p.toFixed(1); })() : "0"}% off)
                </span>
              </div>
            )}
            <div className="flex-1" />
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-7 text-xs"
              onClick={() => handleSave("draft")}
              disabled={isPending}
              data-testid="button-save-draft"
            >
              <Save className="w-3 h-3" />
              Save Draft
            </Button>
            <Button
              size="sm"
              className="gap-1.5 h-7 text-xs bg-orange-600 hover:bg-orange-700"
              onClick={() => handleSave("sent")}
              disabled={isPending}
              data-testid="button-send"
            >
              <Send className="w-3 h-3" />
              Send to Client
            </Button>
          </div>
        </div>
      </div>

      {/* Bottom padding so content isn't hidden behind the banner */}
      <div className="h-20" />
    </AdminLayout>
  );
}
