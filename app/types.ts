export type View = "home" | "restaurants" | "profile";
export type DeliveryApp = "baemin" | "coupang";
export type MembershipApp = DeliveryApp | "";
export type PoolSort = "default" | "deadline" | "remaining";

export type PoolFilters = {
  availableOnly: boolean;
  currentPickupOnly: boolean;
  sortBy: PoolSort;
};

export type MenuItem = {
  id: string;
  name: string;
  description: string;
  price: number;
  badge?: string;
};

export type Restaurant = {
  id: string;
  name: string;
  cuisine: string;
  mark: string;
  tone: string;
  eta: string;
  minimum: Record<DeliveryApp, number>;
  deliveryFee: Record<DeliveryApp, number>;
  address?: string;
  verified?: boolean;
  menu: { title: string; items: MenuItem[] }[];
};

export type Pool = {
  id: string;
  restaurantId: string;
  host: string;
  pickup: string;
  pickupFull: string;
  closesAt: number;
  total: number;
  target: number;
  people: number;
  capacity: number;
  apps: DeliveryApp[];
  membership: string;
  note: string;
  /** `rejected` is derived from the host's block list: the user may request again. */
  myStatus?: "requested" | "approved" | "rejected" | null;
  isHost?: boolean;
  pendingCount?: number;
  estimatedArrival?: string | null;
  orderTotal?: number | null;
  receiptUrl?: string | null;
  receiptUploadedAt?: number | null;
  /** Recruitment extensions the host has used (private room view only). */
  extensions?: number;
};

export type AuthUser = {
  displayName: string;
};

export type RoomMember = {
  member_ref?: string;
  display_name: string;
  role: "host" | "member";
  status: "requested" | "approved";
  created_at: number;
  /** Intended order amount in won; null until the member enters one. */
  amount?: number | null;
  /** 1 for the viewer's own row. */
  mine?: number;
};

export type ChatMessage = {
  id: string;
  sender_name: string;
  body: string;
  created_at: number;
  mine: number;
};

