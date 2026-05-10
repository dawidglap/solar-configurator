export type Company = {
  _id: string;

  name: string;
  slug: string;

  subscriptionStatus: "active" | "expiring_soon" | "suspended";
  plan: "starter" | "professional" | "business" | "enterprise";

  maxUsers: number;
  validUntil: Date;
  notes: string;
  deletedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
};
