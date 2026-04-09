import { pgTable, text, integer, real, boolean, serial, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Sales Reps
export const salesReps = pgTable("sales_reps", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  title: text("title").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
});

export const insertSalesRepSchema = createInsertSchema(salesReps).omit({ id: true });
export type InsertSalesRep = z.infer<typeof insertSalesRepSchema>;
export type SalesRep = typeof salesReps.$inferSelect;

// Estimates
export const estimates = pgTable("estimates", {
  id: serial("id").primaryKey(),
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
  createdAt: timestamp("created_at").notNull().defaultNow(),
  sentAt: timestamp("sent_at"),
  viewedAt: timestamp("viewed_at"),
  approvedAt: timestamp("approved_at"),
  signatureName: text("signature_name"),
  signatureTimestamp: timestamp("signature_timestamp"),
  notesInternal: text("notes_internal"),
  validUntil: text("valid_until").notNull(),
  totalSubCost: real("total_sub_cost").notNull().default(0),
  totalClientPrice: real("total_client_price").notNull().default(0),
  allowanceAmount: real("allowance_amount").notNull().default(0),
  depositAmount: real("deposit_amount").notNull().default(0),
  permitRequired: boolean("permit_required").notNull().default(false),
  uniqueId: text("unique_id").notNull().unique(),
  createdByUserId: integer("created_by_user_id"),
  aiLog: text("ai_log"),
  projectInclusions: text("project_inclusions"),
  projectExclusions: text("project_exclusions"),
});

export const insertEstimateSchema = createInsertSchema(estimates).omit({ id: true });
export type InsertEstimate = z.infer<typeof insertEstimateSchema>;
export type Estimate = typeof estimates.$inferSelect;

// Estimate Line Items
export const lineItems = pgTable("line_items", {
  id: serial("id").primaryKey(),
  estimateId: integer("estimate_id").notNull(),
  sortOrder: integer("sort_order").notNull(),
  phaseGroup: text("phase_group").notNull(),
  customPhaseLabel: text("custom_phase_label"),
  scopeDescription: text("scope_description").notNull(),
  subCost: real("sub_cost").notNull(),
  clientPrice: real("client_price").notNull(),
  isGrouped: boolean("is_grouped").notNull().default(false),
});

export const insertLineItemSchema = createInsertSchema(lineItems).omit({ id: true });
export type InsertLineItem = z.infer<typeof insertLineItemSchema>;
export type LineItem = typeof lineItems.$inferSelect;

// Payment Milestones
export const paymentMilestones = pgTable("payment_milestones", {
  id: serial("id").primaryKey(),
  estimateId: integer("estimate_id").notNull(),
  milestoneName: text("milestone_name").notNull(),
  amount: real("amount").notNull(),
  sortOrder: integer("sort_order").notNull(),
});

export const insertMilestoneSchema = createInsertSchema(paymentMilestones).omit({ id: true });
export type InsertMilestone = z.infer<typeof insertMilestoneSchema>;
export type PaymentMilestone = typeof paymentMilestones.$inferSelect;

// Estimate Events
export const estimateEvents = pgTable("estimate_events", {
  id: serial("id").primaryKey(),
  estimateId: integer("estimate_id").notNull(),
  eventType: text("event_type").notNull(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  metadata: text("metadata"),
});

export const insertEventSchema = createInsertSchema(estimateEvents).omit({ id: true });
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type EstimateEvent = typeof estimateEvents.$inferSelect;

// Users (Google OAuth)
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  googleId: text("google_id").notNull().unique(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  role: text("role").notNull().default("estimator"), // admin | estimator | viewer
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at"),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Contacts (shared client database)
export const contacts = pgTable("contacts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  notes: text("notes"),
  createdByUserId: integer("created_by_user_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertContactSchema = createInsertSchema(contacts).omit({ id: true });
export type InsertContact = z.infer<typeof insertContactSchema>;
export type Contact = typeof contacts.$inferSelect;

// Email Logs
export const emailLogs = pgTable("email_logs", {
  id: serial("id").primaryKey(),
  estimateId: integer("estimate_id").notNull(),
  sentByUserId: integer("sent_by_user_id"),
  recipientEmail: text("recipient_email").notNull(),
  subject: text("subject").notNull(),
  bodyPreview: text("body_preview"),
  gmailMessageId: text("gmail_message_id"),
  emailType: text("email_type").notNull(), // estimate | follow_up_1 | follow_up_2 | confirmation
  status: text("status").notNull().default("sent"), // sent | failed | bounced
  sentAt: timestamp("sent_at").notNull().defaultNow(),
});

export const insertEmailLogSchema = createInsertSchema(emailLogs).omit({ id: true });
export type InsertEmailLog = z.infer<typeof insertEmailLogSchema>;
export type EmailLog = typeof emailLogs.$inferSelect;

// Activity Log (audit trail)
export const activityLog = pgTable("activity_log", {
  id: serial("id").primaryKey(),
  estimateId: integer("estimate_id"),
  userId: integer("user_id"),
  action: text("action").notNull(), // created | edited | sent | viewed | signed | status_changed | note_added | email_sent
  details: text("details"),
  metadata: jsonb("metadata"),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});

export const insertActivitySchema = createInsertSchema(activityLog).omit({ id: true });
export type InsertActivity = z.infer<typeof insertActivitySchema>;
export type ActivityLog = typeof activityLog.$inferSelect;

// Estimate Versions (snapshot on every edit)
export const estimateVersions = pgTable("estimate_versions", {
  id: serial("id").primaryKey(),
  estimateId: integer("estimate_id").notNull(),
  versionNumber: integer("version_number").notNull(),
  snapshotJson: jsonb("snapshot_json").notNull(), // full estimate + line items + milestones
  changedByUserId: integer("changed_by_user_id"),
  changedAt: timestamp("changed_at").notNull().defaultNow(),
  changeSummary: text("change_summary"),
});

export const insertVersionSchema = createInsertSchema(estimateVersions).omit({ id: true });
export type InsertVersion = z.infer<typeof insertVersionSchema>;
export type EstimateVersion = typeof estimateVersions.$inferSelect;

// Pricing History
export const pricingHistory = pgTable("pricing_history", {
  id: serial("id").primaryKey(),
  trade: text("trade").notNull(),
  scopeKeyword: text("scope_keyword").notNull(),
  subCost: real("sub_cost").notNull(),
  city: text("city"),
  source: text("source").notNull().default("user_edit"),
  estimateId: integer("estimate_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPricingHistorySchema = createInsertSchema(pricingHistory).omit({ id: true });
export type InsertPricingHistory = z.infer<typeof insertPricingHistorySchema>;
export type PricingHistory = typeof pricingHistory.$inferSelect;

// Line Item Breakdowns (internal trade-level breakdown for grouped phases)
export const lineItemBreakdowns = pgTable("line_item_breakdowns", {
  id: serial("id").primaryKey(),
  lineItemId: integer("line_item_id").notNull(),
  tradeName: text("trade_name").notNull(),
  subCost: real("sub_cost").notNull().default(0),
  notes: text("notes"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const insertLineItemBreakdownSchema = createInsertSchema(lineItemBreakdowns).omit({ id: true });
export type InsertLineItemBreakdown = z.infer<typeof insertLineItemBreakdownSchema>;
export type LineItemBreakdown = typeof lineItemBreakdowns.$inferSelect;

// Purchase Orders (sub invoices & PO uploads with OCR)
export const purchaseOrders = pgTable("purchase_orders", {
  id: serial("id").primaryKey(),
  estimateId: integer("estimate_id"),
  uploadedByUserId: integer("uploaded_by_user_id"),
  filename: text("filename").notNull(),
  fileUrl: text("file_url").notNull(),
  rawOcrText: text("raw_ocr_text"),
  parsedData: jsonb("parsed_data"),
  status: text("status").notNull().default("pending"), // pending | ocr_complete | parsed | confirmed | error
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPurchaseOrderSchema = createInsertSchema(purchaseOrders).omit({ id: true });
export type InsertPurchaseOrder = z.infer<typeof insertPurchaseOrderSchema>;
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;

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
  { value: "internal_review", label: "Internal Review", color: "yellow" },
  { value: "revised", label: "Revised", color: "blue" },
  { value: "approved", label: "Approved", color: "green" },
  { value: "won", label: "Won", color: "green" },
  { value: "lost", label: "Lost", color: "red" },
  { value: "expired", label: "Expired", color: "red" },
  { value: "declined", label: "Declined", color: "red" },
] as const;
