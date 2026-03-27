export type Company = {
  _id: string;

  name: string;
  slug: string;

  subscriptionStatus: "active" | "trial" | "suspended" | "cancelled";
  plan: "free" | "pro" | "enterprise";

  maxUsers: number;

  createdAt: Date;
  updatedAt: Date;
};