import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { LandingRenderer } from "@/components/landing/renderer";
import { PageTracker } from "@/components/landing/interactive";
import type { LandingPage, LandingPageVariant } from "@/lib/types";

export const dynamic = "force-dynamic";

async function load(slug: string) {
  const db = createAdminClient();
  const { data: page } = await db.from("landing_pages").select("*").eq("slug", slug).eq("status", "published").maybeSingle();
  if (!page) return null;
  const { data: variants } = await db.from("landing_page_variants").select("*").eq("page_id", page.id).eq("is_active", true).order("created_at");
  return { page: page as LandingPage, variants: (variants ?? []) as LandingPageVariant[] };
}

/** Weighted random pick; variants with weight 0 only get traffic if every weight is 0. */
function pickVariant(variants: LandingPageVariant[]) {
  const total = variants.reduce((a, v) => a + Math.max(0, v.weight), 0);
  if (total <= 0) return variants[Math.floor(Math.random() * variants.length)];
  let r = Math.random() * total;
  for (const v of variants) {
    r -= Math.max(0, v.weight);
    if (r < 0) return v;
  }
  return variants[variants.length - 1];
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const data = await load(slug);
  if (!data) return { title: "Not found" };
  return {
    title: { absolute: data.page.seo_title || data.page.name },
    description: data.page.seo_description || undefined,
    openGraph: { title: data.page.seo_title || data.page.name, description: data.page.seo_description || undefined },
  };
}

export default async function PublicLandingPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const data = await load(slug);
  if (!data || data.variants.length === 0) notFound();
  const { page, variants } = data;

  const jar = await cookies();
  const forced = sp.variant ? variants.find((v) => v.id === sp.variant || v.name.toLowerCase() === sp.variant!.toLowerCase()) : undefined;
  const sticky = variants.find((v) => v.id === jar.get(`rs_v_${page.id}`)?.value);
  const variant = forced ?? sticky ?? pickVariant(variants);

  let calendlyUrl = page.calendly_url;
  if (!calendlyUrl && page.after_submit === "calendly") {
    const { data: ws } = await createAdminClient().from("workspace_settings").select("default_calendly_url").eq("id", 1).single();
    calendlyUrl = ws?.default_calendly_url ?? null;
  }

  return (
    <div className="min-h-screen" style={{ fontSize: 16 }}>
      <PageTracker pageId={page.id} variantId={variant.id} />
      <LandingRenderer page={page} variantId={variant.id} sections={variant.sections} calendlyUrl={calendlyUrl} />
    </div>
  );
}
