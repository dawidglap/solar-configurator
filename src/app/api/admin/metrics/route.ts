import { getCorsHeaders } from "@/lib/cors";
import { getDb } from "@/lib/db";
import { readSession } from "@/lib/api-session";
import {
  COMPANY_PLANS,
  buildActiveCompanyFilter,
  buildActiveMembershipCompanyQuery,
  enforceAdminRateLimit,
  normalizeCompanySubscription,
  requirePlatformSuperAdmin,
} from "@/lib/subscription";
import { activeDocumentFilter } from "@/lib/trash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonResponse(origin: string | null, body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...getCorsHeaders(origin),
    },
  });
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

export async function GET(req: Request) {
  const origin = req.headers.get("origin");
  const secret = process.env.SESSION_SECRET;
  if (!secret) return jsonResponse(origin, { ok: false, message: "Missing SESSION_SECRET" }, 500);

  const session = readSession(req, secret);
  if (!session?.userId) return jsonResponse(origin, { ok: false, message: "Not logged in" }, 401);

  const forbidden = requirePlatformSuperAdmin(origin, session);
  if (forbidden) return forbidden;

  const rateLimit = await enforceAdminRateLimit(origin, session);
  if (rateLimit) return rateLimit;

  try {
    const db = await getDb();
    const companiesCol = db.collection("companies");
    const usersCol = db.collection("users");
    const planningsCol = db.collection("plannings");

    const companies = await companiesCol
      .find(buildActiveCompanyFilter())
      .project({ plan: 1, subscriptionStatus: 1, validUntil: 1, _id: 1 })
      .toArray();

    const now = Date.now();
    const normalizedCompanies = companies.map((company) => normalizeCompanySubscription(company));
    const totalCompanies = companies.length;
    const activeCompanies = normalizedCompanies.filter((company) => company.subscriptionStatus === "active").length;
    const suspendedCompanies = normalizedCompanies.filter((company) => company.subscriptionStatus === "suspended").length;
    const expiredCompanies = normalizedCompanies.filter(
      (company) => company.validUntil.getTime() <= now,
    ).length;
    const trialCompanies = normalizedCompanies.filter((company) => company.subscriptionStatus === "trial").length;
    const expiringSoon = normalizedCompanies.filter((company) => {
      const delta = company.validUntil.getTime() - now;
      return delta > 0 && delta <= 14 * 24 * 60 * 60 * 1000;
    }).length;

    const planDistribution = Object.fromEntries(COMPANY_PLANS.map((plan) => [plan, 0])) as Record<string, number>;
    for (const company of normalizedCompanies) {
      if (company.plan && planDistribution[company.plan] !== undefined) {
        planDistribution[company.plan] += 1;
      }
    }

    const companyIds = companies.map((company) => String(company._id));

    const userDocs = await usersCol
      .find({ status: { $ne: "inactive" } })
      .project({ memberships: 1 })
      .toArray();
    const totalUsers = userDocs.filter((user) =>
      companyIds.some((companyId) =>
        Array.isArray(user.memberships) &&
        user.memberships.some((membership: any) => {
          const match = buildActiveMembershipCompanyQuery(companyId).memberships.$elemMatch;
          const companyValue = membership?.companyId;
          const sameCompany = match.companyId.$in.some((variant: any) => String(variant) === String(companyValue));
          return sameCompany && membership?.status === "active";
        }),
      ),
    ).length;

    const totalProjects = await planningsCol.countDocuments(activeDocumentFilter());

    return jsonResponse(origin, {
      ok: true,
      data: {
        totalCompanies,
        activeCompanies,
        suspendedCompanies,
        expiredCompanies,
        trialCompanies,
        totalUsers,
        totalProjects,
        expiringSoon,
        planDistribution,
        byPlan: planDistribution,
      },
    });
  } catch (e: any) {
    console.error("ADMIN METRICS ERROR:", e);
    return jsonResponse(origin, { ok: false, message: e?.message || "Unknown error" }, 500);
  }
}
