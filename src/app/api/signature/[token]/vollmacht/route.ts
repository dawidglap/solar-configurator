import {
  GET as publicGet,
  OPTIONS as publicOptions,
  POST as publicPost,
} from "@/app/api/public/offer-signature/[token]/vollmacht/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export { publicGet as GET, publicOptions as OPTIONS, publicPost as POST };
