import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  customer_phone: text("customer_phone").notNull(),
  direction: text("direction").notNull(), // 'inbound' | 'outbound'
  message_text: text("message_text").notNull(),
  created_at: timestamp("created_at").defaultNow(),
  sender: text("sender").notNull(), // 'customer' | 'ai' | 'agent'
  escalation_id: integer("escalation_id"),
  // Voice note fields — null for ordinary text messages
  media_type: text("media_type"),      // 'audio' for voice notes
  media_url: text("media_url"),        // playback URL served by the bot backend
  transcription: text("transcription"), // Whisper speech-to-text output
  company_id: integer("company_id").default(1),
});

export const escalations = pgTable("escalations", {
  id: serial("id").primaryKey(),
  customer_phone: text("customer_phone").notNull(),
  escalation_reason: text("escalation_reason"),
  status: text("status").notNull().default('open'), // 'open' | 'closed' | 'in_progress'
  created_at: timestamp("created_at").defaultNow(),
  assigned_agent_id: integer("assigned_agent_id"),
  company_id: integer("company_id").default(1),
});

export const insertMessageSchema = createInsertSchema(messages).omit({ id: true, created_at: true });
export const insertEscalationSchema = createInsertSchema(escalations).omit({ id: true, created_at: true });

export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Escalation = typeof escalations.$inferSelect;
export type InsertEscalation = z.infer<typeof insertEscalationSchema>;

// A unified conversation view: derived from messages table, joined with escalation status
export interface Conversation {
  customer_phone: string;
  last_message: string;
  last_message_at: string | null;
  escalation_status: string | null; // 'open' | 'closed' | null (no escalation record)
  escalation_reason: string | null;
  assigned_agent_id: number | null;
  assigned_agent_name: string | null;
}
