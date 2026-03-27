export type UserMembership = {
  companyId: string;
  role:
    | "owner"
    | "admin"
    | "sales"
    | "installer"
    | "office"
    | "viewer";
  isDefault?: boolean;
  status?: "active" | "invited" | "disabled";
};

export type User = {
  _id: string;

  email: string;
  passwordHash: string;

  firstName?: string;
  lastName?: string;

  isPlatformSuperAdmin: boolean;

  status: "active" | "invited" | "disabled";

  memberships: UserMembership[];

  createdAt: Date;
  updatedAt: Date;
};