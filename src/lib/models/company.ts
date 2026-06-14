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
    dunningFees?: number[] | Record<string, number>;
    dunningTermDays?: number;
  };

  templates?: {
    invoiceText?: string;
  };

  createdAt: Date;
  updatedAt: Date;
};
