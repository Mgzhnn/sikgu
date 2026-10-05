import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const rooms = sqliteTable("rooms", {
  id: text("id").primaryKey(),
  hostEmail: text("host_email").notNull(),
  hostName: text("host_name").notNull(),
  restaurantId: text("restaurant_id").notNull(),
  pickup: text("pickup").notNull(),
  pickupFull: text("pickup_full").notNull(),
  apps: text("apps").notNull(),
  closesAt: integer("closes_at").notNull(),
  total: integer("total").notNull().default(0),
  target: integer("target").notNull(),
  capacity: integer("capacity").notNull(),
  membership: text("membership").notNull(),
  note: text("note").notNull(),
  estimatedArrival: text("estimated_arrival"),
  orderTotal: integer("order_total"),
  receiptKey: text("receipt_key"),
  receiptContentType: text("receipt_content_type"),
  receiptUploadedAt: integer("receipt_uploaded_at"),
  mutationToken: text("mutation_token"),
  mutationStartedAt: integer("mutation_started_at"),
  status: text("status").notNull().default("open"),
  /** Host-granted recruitment extensions used so far (bounded by the API). */
  extensions: integer("extensions").notNull().default(0),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  index("rooms_status_closes_idx").on(table.status, table.closesAt),
  index("rooms_host_idx").on(table.hostEmail),
  index("rooms_status_created_idx").on(table.status, table.createdAt, table.id),
]);

export const roomMembers = sqliteTable("room_members", {
  roomId: text("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
  userEmail: text("user_email").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull().default("member"),
  status: text("status").notNull().default("requested"),
  reviewToken: text("review_token"),
  /**
   * What this member intends to order, in won. `rooms.total` is maintained
   * as the sum over approved members, so nobody types the pooled amount by
   * hand.
   */
  amount: integer("amount"),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.roomId, table.userEmail] }),
  index("room_members_user_idx").on(table.userEmail, table.status),
  index("room_members_room_status_idx").on(table.roomId, table.status),
]);

export const roomInvites = sqliteTable("room_invites", {
  token: text("token").primaryKey(),
  roomId: text("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
  createdByEmail: text("created_by_email").notNull(),
  maxUses: integer("max_uses").notNull(),
  uses: integer("uses").notNull().default(0),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  index("room_invites_room_idx").on(table.roomId),
]);

/**
 * Users the host has removed or rejected from a room. A block only closes the
 * unattended path (invite links); a blocked user can still request to join
 * and be approved explicitly by the host.
 */
export const roomBlocks = sqliteTable("room_blocks", {
  roomId: text("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
  userEmail: text("user_email").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.roomId, table.userEmail] }),
]);

export const roomMessages = sqliteTable("room_messages", {
  id: text("id").primaryKey(),
  roomId: text("room_id").notNull().references(() => rooms.id, { onDelete: "cascade" }),
  senderEmail: text("sender_email").notNull(),
  senderName: text("sender_name").notNull(),
  body: text("body").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  index("room_messages_room_created_idx").on(table.roomId, table.createdAt, table.id),
  index("room_messages_sender_created_idx").on(table.roomId, table.senderEmail, table.createdAt),
]);
