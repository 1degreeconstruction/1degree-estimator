import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { format, addDays } from "date-fns";

function generateUniqueId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateEstimateNumber(): string {
  const now = new Date();
  const dateStr = format(now, "yyyyMMdd");
  const existing = storage.getEstimates();
  const todayEstimates = existing.filter(e => e.estimateNumber.includes(dateStr));
  const seq = String(todayEstimates.length + 1).padStart(3, "0");
  return `1DC-${dateStr}-${seq}`;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Sales Reps
  app.get("/api/sales-reps", (_req, res) => {
    const reps = storage.getSalesReps();
    res.json(reps);
  });

  // Estimates - list
  app.get("/api/estimates", (_req, res) => {
    const estimatesList = storage.getEstimates();
    const reps = storage.getSalesReps();
    const enriched = estimatesList.map(e => ({
      ...e,
      salesRep: reps.find(r => r.id === e.salesRepId),
    }));
    res.json(enriched);
  });

  // Estimates - get one by ID
  app.get("/api/estimates/:id", (req, res) => {
    const id = parseInt(req.params.id);
    const estimate = storage.getEstimate(id);
    if (!estimate) return res.status(404).json({ error: "Not found" });
    
    const salesRep = storage.getSalesRep(estimate.salesRepId);
    const items = storage.getLineItems(id);
    const milestones = storage.getMilestones(id);
    const events = storage.getEvents(id);
    
    res.json({ ...estimate, salesRep, lineItems: items, milestones, events });
  });

  // Estimates - get by unique ID (client-facing)
  app.get("/api/estimates/public/:uniqueId", (req, res) => {
    const estimate = storage.getEstimateByUniqueId(req.params.uniqueId);
    if (!estimate) return res.status(404).json({ error: "Not found" });
    
    // Log view event
    if (estimate.status === "sent") {
      storage.updateEstimate(estimate.id, { 
        status: "viewed", 
        viewedAt: new Date().toISOString() 
      });
      storage.createEvent({
        estimateId: estimate.id,
        eventType: "viewed",
        timestamp: new Date().toISOString(),
        metadata: req.ip || null,
      });
    }
    
    const salesRep = storage.getSalesRep(estimate.salesRepId);
    const items = storage.getLineItems(estimate.id);
    const milestones = storage.getMilestones(estimate.id);
    
    // Strip internal costs for client view
    const clientItems = items.map(({ subCost, ...item }) => item);
    
    res.json({ 
      ...estimate, 
      totalSubCost: undefined,
      salesRep, 
      lineItems: clientItems, 
      milestones 
    });
  });

  // Create estimate
  app.post("/api/estimates", (req, res) => {
    try {
      const { lineItems: items, milestones, ...estimateData } = req.body;
      
      const now = new Date();
      const estimateNumber = generateEstimateNumber();
      const uniqueId = generateUniqueId();
      
      // Calculate totals
      let totalSubCost = 0;
      if (items) {
        for (const item of items) {
          totalSubCost += item.subCost || 0;
        }
      }
      const totalBeforeAllowance = totalSubCost * 2;
      const allowanceAmount = Math.round(totalBeforeAllowance * 0.03 * 100) / 100;
      const totalClientPrice = Math.round((totalBeforeAllowance + allowanceAmount) * 100) / 100;
      const depositAmount = Math.min(1000, Math.round(totalClientPrice * 0.1 * 100) / 100);
      
      const estimate = storage.createEstimate({
        estimateNumber,
        uniqueId,
        clientName: estimateData.clientName,
        clientEmail: estimateData.clientEmail,
        clientPhone: estimateData.clientPhone,
        projectAddress: estimateData.projectAddress,
        city: estimateData.city,
        state: estimateData.state,
        zip: estimateData.zip,
        salesRepId: estimateData.salesRepId,
        status: estimateData.status || "draft",
        createdAt: now.toISOString(),
        validUntil: addDays(now, 45).toISOString(),
        totalSubCost,
        totalClientPrice,
        allowanceAmount,
        depositAmount,
        permitRequired: estimateData.permitRequired || false,
        notesInternal: estimateData.notesInternal || null,
        sentAt: estimateData.status === "sent" ? now.toISOString() : null,
        viewedAt: null,
        approvedAt: null,
        signatureName: null,
        signatureTimestamp: null,
      });

      // Create line items
      if (items && items.length > 0) {
        for (const item of items) {
          storage.createLineItem({
            estimateId: estimate.id,
            sortOrder: item.sortOrder,
            phaseGroup: item.phaseGroup,
            scopeDescription: item.scopeDescription,
            subCost: item.subCost,
            clientPrice: item.subCost * 2,
            isGrouped: item.isGrouped || false,
          });
        }
      }

      // Create milestones
      if (milestones && milestones.length > 0) {
        for (const m of milestones) {
          storage.createMilestone({
            estimateId: estimate.id,
            milestoneName: m.milestoneName,
            amount: m.amount,
            sortOrder: m.sortOrder,
          });
        }
      }

      // Log event
      storage.createEvent({
        estimateId: estimate.id,
        eventType: "created",
        timestamp: now.toISOString(),
        metadata: null,
      });

      if (estimateData.status === "sent") {
        storage.createEvent({
          estimateId: estimate.id,
          eventType: "sent",
          timestamp: now.toISOString(),
          metadata: null,
        });
      }

      res.json(estimate);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Update estimate
  app.put("/api/estimates/:id", (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { lineItems: items, milestones, ...estimateData } = req.body;
      
      // Calculate totals
      let totalSubCost = 0;
      if (items) {
        for (const item of items) {
          totalSubCost += item.subCost || 0;
        }
      }
      const totalBeforeAllowance = totalSubCost * 2;
      const allowanceAmount = Math.round(totalBeforeAllowance * 0.03 * 100) / 100;
      const totalClientPrice = Math.round((totalBeforeAllowance + allowanceAmount) * 100) / 100;
      const depositAmount = Math.min(1000, Math.round(totalClientPrice * 0.1 * 100) / 100);
      
      const now = new Date();
      const wasDraft = storage.getEstimate(id)?.status === "draft";
      const isSending = estimateData.status === "sent" && wasDraft;

      const estimate = storage.updateEstimate(id, {
        clientName: estimateData.clientName,
        clientEmail: estimateData.clientEmail,
        clientPhone: estimateData.clientPhone,
        projectAddress: estimateData.projectAddress,
        city: estimateData.city,
        state: estimateData.state,
        zip: estimateData.zip,
        salesRepId: estimateData.salesRepId,
        status: estimateData.status,
        totalSubCost,
        totalClientPrice,
        allowanceAmount,
        depositAmount,
        permitRequired: estimateData.permitRequired || false,
        notesInternal: estimateData.notesInternal || null,
        sentAt: isSending ? now.toISOString() : undefined,
      });

      if (!estimate) return res.status(404).json({ error: "Not found" });

      // Replace line items
      storage.deleteLineItemsByEstimate(id);
      if (items && items.length > 0) {
        for (const item of items) {
          storage.createLineItem({
            estimateId: id,
            sortOrder: item.sortOrder,
            phaseGroup: item.phaseGroup,
            scopeDescription: item.scopeDescription,
            subCost: item.subCost,
            clientPrice: item.subCost * 2,
            isGrouped: item.isGrouped || false,
          });
        }
      }

      // Replace milestones
      storage.deleteMilestonesByEstimate(id);
      if (milestones && milestones.length > 0) {
        for (const m of milestones) {
          storage.createMilestone({
            estimateId: id,
            milestoneName: m.milestoneName,
            amount: m.amount,
            sortOrder: m.sortOrder,
          });
        }
      }

      if (isSending) {
        storage.createEvent({
          estimateId: id,
          eventType: "sent",
          timestamp: now.toISOString(),
          metadata: null,
        });
      }

      res.json(estimate);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Client sign estimate
  app.post("/api/estimates/public/:uniqueId/sign", (req, res) => {
    const estimate = storage.getEstimateByUniqueId(req.params.uniqueId);
    if (!estimate) return res.status(404).json({ error: "Not found" });
    
    const { signatureName } = req.body;
    if (!signatureName) return res.status(400).json({ error: "Signature name required" });
    
    const now = new Date().toISOString();
    const updated = storage.updateEstimate(estimate.id, {
      status: "approved",
      approvedAt: now,
      signatureName,
      signatureTimestamp: now,
    });

    storage.createEvent({
      estimateId: estimate.id,
      eventType: "approved",
      timestamp: now,
      metadata: JSON.stringify({ ip: req.ip, signatureName }),
    });

    res.json(updated);
  });

  // Update status 
  app.patch("/api/estimates/:id/status", (req, res) => {
    const id = parseInt(req.params.id);
    const { status } = req.body;
    const estimate = storage.updateEstimate(id, { status });
    if (!estimate) return res.status(404).json({ error: "Not found" });

    storage.createEvent({
      estimateId: id,
      eventType: status,
      timestamp: new Date().toISOString(),
      metadata: null,
    });

    res.json(estimate);
  });

  return httpServer;
}
