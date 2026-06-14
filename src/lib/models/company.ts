export type Company = {
  _id: string;

  name: string;
  slug: string;

  subscriptionStatus: "trial" | "active" | "expiring_soon" | "suspended";
  plan: "starter" | "professional" | "business" | "enterprise";

  maxUsers: number;
  validUntil: Date;
  notes: string;
  deletedAt?: Date;

  bank?: {
    bankName?: string;
    iban?: string;
    accountHolder?: string;
    bicSwift?: string;
  };

  paymentDefaults?: {
    termDays?: number;
    currency?: string;
  };

  createdAt: Date;
  updatedAt: Date;
};
