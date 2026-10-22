import type { LandingSection } from "@/lib/types";

export type SectionType = LandingSection["type"];

export const SECTION_LABELS: Record<SectionType, string> = {
  hero: "Hero",
  features: "Features",
  social_proof: "Social proof",
  stats: "Stats",
  faq: "FAQ",
  form: "Lead form",
  cta: "Call to action",
  video: "Video",
  rich_text: "Rich text",
};

export const uid = () => Math.random().toString(36).slice(2, 10);

export function newSection(type: SectionType): LandingSection {
  const id = uid();
  switch (type) {
    case "hero":
      return { id, type, headline: "Your headline goes here", subheadline: "A short, specific promise of the outcome you deliver.", cta: "Book a free call", align: "center" };
    case "features":
      return { id, type, heading: "What you get", items: [
        { title: "Feature one", body: "Explain the benefit in one sentence." },
        { title: "Feature two", body: "Explain the benefit in one sentence." },
        { title: "Feature three", body: "Explain the benefit in one sentence." },
      ] };
    case "social_proof":
      return { id, type, heading: "Trusted by growing teams", testimonials: [{ quote: "They delivered exactly what they promised, ahead of schedule.", name: "Jane Doe", role: "COO, Acme" }] };
    case "stats":
      return { id, type, items: [{ value: "40+", label: "Hours saved / month" }, { value: "3.2x", label: "Avg. ROI" }, { value: "14 days", label: "To go live" }] };
    case "faq":
      return { id, type, heading: "Frequently asked questions", items: [{ q: "How long does it take?", a: "Most projects go live in 2–4 weeks." }] };
    case "form":
      return { id, type, heading: "Get started", subheading: "Tell us a bit about you and we'll be in touch within one business day.", button: "Submit", fields: ["first_name", "last_name", "email", "phone"] };
    case "cta":
      return { id, type, headline: "Ready to get started?", body: "Book a 20-minute call and see what AI can do for your business.", button: "Book a call" };
    case "video":
      return { id, type, heading: "See how it works", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" };
    case "rich_text":
      return { id, type, markdown: "## Heading\n\nWrite anything here using **markdown**." };
  }
}

export interface PageTemplate {
  key: string;
  name: string;
  description: string;
  sections: () => LandingSection[];
}

export const PAGE_TEMPLATES: PageTemplate[] = [
  {
    key: "book_call",
    name: "AI Automation Agency – Book a Call",
    description: "Classic agency funnel: hero, outcomes, proof, form → Calendly.",
    sections: () => [
      { id: uid(), type: "hero", headline: "Put your busywork on autopilot with custom AI agents", subheadline: "We design, build and run AI automations that save your team 40+ hours a month — live in 14 days, or you don't pay.", cta: "Book your free strategy call", align: "center" },
      { id: uid(), type: "stats", items: [{ value: "40+ hrs", label: "Saved per month" }, { value: "14 days", label: "Average time to launch" }, { value: "3.2x", label: "Average first-year ROI" }] },
      { id: uid(), type: "features", heading: "What we automate", items: [
        { title: "Lead follow-up", body: "Instant SMS + email follow-up and qualification for every new lead, 24/7." },
        { title: "Customer support", body: "AI agents that resolve common tickets and hand off the rest with full context." },
        { title: "Back-office ops", body: "Invoicing, reporting and data entry handled without a human in the loop." },
      ] },
      { id: uid(), type: "social_proof", heading: "Operators love working with us", testimonials: [
        { quote: "We cut our response time from 6 hours to 30 seconds. Booked calls doubled in the first month.", name: "Marcus L.", role: "Founder, Peak Roofing" },
        { quote: "The support agent handles 70% of our tickets. Our team finally works on the hard stuff.", name: "Priya S.", role: "Head of CX, Lumen" },
      ] },
      { id: uid(), type: "form", heading: "Book your free strategy call", subheading: "Tell us where you're losing time. We'll map out your first 3 automations on the call.", button: "Continue to scheduling", fields: ["first_name", "last_name", "email", "phone", "company"] },
      { id: uid(), type: "faq", heading: "Questions", items: [
        { q: "Do I need technical staff?", a: "No. We build, host and maintain everything for you." },
        { q: "What does it cost?", a: "Projects start with a one-time build fee plus a monthly retainer for hosting, monitoring and improvements." },
        { q: "What if it doesn't work?", a: "If we don't launch in 14 days, your setup fee is refunded." },
      ] },
    ],
  },
  {
    key: "audit",
    name: "Free AI Audit",
    description: "Lead magnet: request a free AI opportunity audit.",
    sections: () => [
      { id: uid(), type: "hero", headline: "Get a free AI audit of your business", subheadline: "In 48 hours we'll send you a custom report showing exactly where AI can save you time and money.", cta: "Claim my free audit", align: "left" },
      { id: uid(), type: "features", heading: "Your audit includes", items: [
        { title: "Workflow map", body: "Every repetitive process we found, ranked by hours saved." },
        { title: "ROI estimate", body: "Projected savings and payback period for each automation." },
        { title: "Action plan", body: "A step-by-step rollout plan you can run with or without us." },
      ] },
      { id: uid(), type: "form", heading: "Request your audit", subheading: "Takes 60 seconds.", button: "Send me my audit", fields: ["first_name", "email", "phone", "company", "website", "message"] },
    ],
  },
  {
    key: "webinar",
    name: "Webinar Registration",
    description: "Register for a live training.",
    sections: () => [
      { id: uid(), type: "hero", headline: "Free live training: How to replace 3 roles with AI agents", subheadline: "Thursday at 1pm ET · 45 minutes · Live Q&A", cta: "Save my seat", align: "center" },
      { id: uid(), type: "rich_text", markdown: "### What you'll learn\n\n- The 3 agent types every business should deploy first\n- How to measure ROI before you build\n- Live build: a lead-qualification agent in 15 minutes" },
      { id: uid(), type: "form", heading: "Reserve your spot", button: "Register", fields: ["first_name", "email", "phone"] },
      { id: uid(), type: "cta", headline: "Can't make it live?", body: "Register anyway and we'll send you the replay.", button: "Register now" },
    ],
  },
  {
    key: "blank",
    name: "Blank page",
    description: "Start from a hero and a form.",
    sections: () => [newSection("hero"), newSection("form")],
  },
];

export const FORM_FIELD_LABELS: Record<string, string> = {
  first_name: "First name",
  last_name: "Last name",
  email: "Email",
  phone: "Phone",
  company: "Company",
  website: "Website",
  message: "How can we help?",
};
