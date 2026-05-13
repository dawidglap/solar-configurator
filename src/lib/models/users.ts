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

export type ExecutionRole = "montage" | "elektro";

export type User = {
  _id: string;

  email: string;
  passwordHash: string;

  firstName?: string;
  lastName?: string;

  isPlatformSuperAdmin: boolean;

  status: "active" | "invited" | "disabled";

  memberships: UserMembership[];
  executionRoles?: ExecutionRole[];

  createdAt: Date;
  updatedAt: Date;
};
