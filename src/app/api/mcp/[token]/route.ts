import type { NextRequest } from "next/server";
import { mcpHandler } from "@/lib/mcp/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const h = async (req: NextRequest, { params }: { params: Promise<{ token: string }> }) => mcpHandler(req, (await params).token);
export const GET = h;
export const POST = h;
export const DELETE = h;
