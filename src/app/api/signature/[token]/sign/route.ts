import {
  OPTIONS as publicOptions,
  POST as publicPost,
} from "@/app/api/public/offer-signature/[token]/sign/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export { publicOptions as OPTIONS, publicPost as POST };
