import {
  OPTIONS as offerOptions,
  POST as offerPost,
} from "@/app/api/plannings/[planningId]/offer/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const OPTIONS = offerOptions;
export const POST = offerPost;
