import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Sales Reps
export const salesReps = sqliteTable("sales_reps", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  title: text("title").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
});

export const insertSalesRepSchema = createInsertSchema(salesReps).omit({ id: true });
export type InsertSalesRep = z.infer<typeof insertSalesRepSchema>;
export type SalesRep = typeof salesReps.$inferSelect;

// Estimates
export const estimates = sqliteTable("estimates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  estimateNumber: text("estimate_number").notNull().unique(),
  clientName: text("client_name").notNull(),
  clientEmail: text("client_email").notNull(),
  clientPhone: text("client_phone").notNull(),
  projectAddress: text("project_address").notNull(),
  city: text("city").notNull(),
  state: text("state").notNull(),
  zip: text("zip").notNull(),
  salesRepId: integer("sales_rep_id").notNull(),
  status: text("status").notNull().default("draft"),
  createdAt: text("created_at").notNull(),
  sentAt: text("sent_at"),
  viewedAt: text("viewed_at"),
  approvedAt: text("approved_at"),
  signatureName: text("signature_name"),
  signatureTimestamp: text("signature_timestamp"),
  notesInternal: text("notes_internal"),
  validUntil: text("valid_until").notNull(),
  totalSubCost: real("total_sub_cost").notNull().default(0),
  totalClientPrice: real("total_client_price").notNull().default(0),
  allowanceAmount: real("allowance_amount").notNull().default(0),
  depositAmount: real("deposit_amount").notNull().default(0),
  permitRequired: integer("permit_required", { mode: "boolean" }).notNull().default(false),
  uniqueId: text("unique_id").notNull().unique(),
});

export const insertEstimateSchema = createInsertSchema(estimates).omit({ id: true });
export type InsertEstimate = z.infer<typeof insertEstimateSchema>;
export type Estimate = typeof estimates.$inferSelect;

// Estimate Line Items
export const lineItems = sqliteTable("line_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  estimateId: integer("estimate_id").notNull(),
  sortOrder: integer("sort_order").notNull(),
  phaseGroup: text("phase_group").notNull(),
  scopeDescription: text("scope_description").notNull(),
  subCost: real("sub_cost").notNull(),
  clientPrice: real("client_price").notNull(),
  isGrouped: integer("is_grouped", { mode: "boolean" }).notNull().default(false),
});

export const insertLineItemSchema = createInsertSchema(lineItems).omit({ id: true });
export type InsertLineItem = z.infer<typeof insertLineItemSchema>;
export type LineItem = typeof lineItems.$inferSelect;

// Payment Milestones
export const paymentMilestones = sqliteTable("payment_milestones", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  estimateId: integer("estimate_id").notNull(),
  milestoneName: text("milestone_name").notNull(),
  amount: real("amount").notNull(),
  sortOrder: integer("sort_order").notNull(),
});

export const insertMilestoneSchema = createInsertSchema(paymentMilestones).omit({ id: true });
export type InsertMilestone = z.infer<typeof insertMilestoneSchema>;
export type PaymentMilestone = typeof paymentMilestones.$inferSelect;

// Estimate Events
export const estimateEvents = sqliteTable("estimate_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  estimateId: integer("estimate_id").notNull(),
  eventType: text("event_type").notNull(),
  timestamp: text("timestamp").notNull(),
  metadata: text("metadata"),
});

export const insertEventSchema = createInsertSchema(estimateEvents).omit({ id: true });
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type EstimateEvent = typeof estimateEvents.$inferSelect;

// Phase group constants
export const PHASE_GROUPS = [
  { value: "permit_design", label: "Permit & Design" },
  { value: "planning", label: "Planning" },
  { value: "general_conditions", label: "General Conditions" },
  { value: "demolition", label: "Demolition" },
  { value: "framing", label: "Framing" },
  { value: "mep", label: "MEP (Mechanical, Electrical, Plumbing)" },
  { value: "insulation_drywall_paint", label: "Insulation, Drywall & Paint" },
  { value: "tile_finish_carpentry", label: "Tile, Stone & Finish Carpentry" },
  { value: "other", label: "Other" },
] as const;

export const GROUPED_PHASES = ["mep", "insulation_drywall_paint", "tile_finish_carpentry"];

export const STATUS_OPTIONS = [
  { value: "draft", label: "Draft", color: "secondary" },
  { value: "sent", label: "Sent", color: "blue" },
  { value: "viewed", label: "Viewed", color: "purple" },
  { value: "follow_up_1", label: "Follow Up 1", color: "orange" },
  { value: "follow_up_2", label: "Follow Up 2", color: "orange" },
  { value: "approved", label: "Approved", color: "green" },
  { value: "expired", label: "Expired", color: "red" },
  { value: "declined", label: "Declined", color: "red" },
] as const;
