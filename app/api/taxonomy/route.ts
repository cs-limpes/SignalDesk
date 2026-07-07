import { requireAuth } from "@/lib/auth";
import { jsonError } from "@/lib/route";
import { fetchTaxonomy } from "@/lib/wordpress";

export const runtime = "edge";

export async function GET(request: Request) {
  try {
    requireAuth(request);
    const taxonomy = await fetchTaxonomy();
    return Response.json(taxonomy);
  } catch (error) {
    return jsonError(error, 503);
  }
}
