/** Auto-map CSV columns to contact fields. Pure: safe on client and server. */

export type BuiltinField = "full_name" | "first_name" | "last_name" | "phone" | "email" | "company" | "title" | "notes";

export type ColumnMap =
  | { kind: "skip" }
  | { kind: "field"; field: BuiltinField }
  | { kind: "custom"; key: string };

export const BUILTIN_FIELDS: { field: BuiltinField; label: string; synonyms: string[] }[] = [
  { field: "phone", label: "Phone", synonyms: ["phone", "phone number", "phone 1", "primary phone", "mobile", "mobile phone", "mobile number", "cell", "cell phone", "tel", "telephone", "number", "contact number", "business phone", "work phone", "direct", "direct line"] },
  { field: "email", label: "Email", synonyms: ["email", "e mail", "email address", "e mail address", "mail", "work email", "business email", "contact email", "primary email"] },
  { field: "first_name", label: "First name", synonyms: ["first", "first name", "firstname", "given name", "fname"] },
  { field: "last_name", label: "Last name", synonyms: ["last", "last name", "lastname", "surname", "family name", "lname"] },
  { field: "full_name", label: "Name", synonyms: ["name", "full name", "fullname", "contact", "contact name", "owner", "owner name", "decision maker", "person", "lead name", "prospect"] },
  { field: "company", label: "Company", synonyms: ["company", "company name", "business", "business name", "organization", "organisation", "org", "account", "account name", "brand", "employer", "firm"] },
  { field: "title", label: "Job title", synonyms: ["title", "job title", "position", "role", "job", "designation"] },
  { field: "notes", label: "Notes", synonyms: ["note", "notes", "comment", "comments", "description", "about", "remarks"] },
];

export const fieldLabel = (f: BuiltinField) => BUILTIN_FIELDS.find((x) => x.field === f)?.label ?? f;

/** "Phone #" → "phone", "E-mail_Address" → "e mail address". */
export function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[_\-./#:()[\]]+/g, " ").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

/** Storage key for a new custom field: "Google Rating" → "google_rating". */
export function customKey(h: string): string {
  return normalizeHeader(h).replace(/ /g, "_") || "field";
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isPhone = (v: string) => /^[+()\d\s.\-x]+$/i.test(v) && v.replace(/\D/g, "").length >= 10 && v.replace(/\D/g, "").length <= 15;

/** Share of non-empty sample values that pass a test. */
function share(values: string[], test: (v: string) => boolean) {
  const vals = values.map((v) => v.trim()).filter(Boolean);
  return vals.length ? vals.filter(test).length / vals.length : 0;
}

/**
 * Map each header to a built-in field, an existing custom field, or a new custom field.
 * Each built-in is claimed once; exact header matches win over partial ones, and
 * phone/email columns are also detected from their values.
 */
export function autoMap(header: string[], sample: string[][], existingCustomKeys: string[] = []): ColumnMap[] {
  const cols = header.map((h, i) => ({ i, h, n: normalizeHeader(h), values: sample.map((r) => r[i] ?? "") }));
  const out: (ColumnMap | null)[] = header.map(() => null);
  const used = new Set<BuiltinField>();
  const claim = (i: number, field: BuiltinField) => { out[i] = { kind: "field", field }; used.add(field); };

  // Empty columns are skipped.
  for (const c of cols) if (!c.values.some((v) => v.trim())) out[c.i] = { kind: "skip" };

  // Pass 1: exact synonym match. Pass 2: header contains a synonym (whole words).
  for (const exact of [true, false]) {
    for (const def of BUILTIN_FIELDS) {
      if (used.has(def.field)) continue;
      const hit = cols.find((c) => !out[c.i] && def.synonyms.some((s) =>
        exact ? c.n === s : s.length >= 5 &&new RegExp(`(^| )${s}( |$)`).test(c.n)));
      if (!hit) continue;
      // Guard against "Phone status" style columns whose values aren't phones/emails.
      if (def.field === "phone" && hit.values.some((v) => v.trim()) && share(hit.values, isPhone) < 0.5) continue;
      if (def.field === "email" && hit.values.some((v) => v.trim()) && share(hit.values, (v) => EMAIL_RE.test(v)) < 0.5) continue;
      claim(hit.i, def.field);
    }
  }

  // Pass 3: sniff values for phone/email in unlabeled columns.
  for (const [field, test] of [["phone", isPhone], ["email", (v: string) => EMAIL_RE.test(v)]] as const) {
    if (used.has(field)) continue;
    const hit = cols.find((c) => !out[c.i] && share(c.values, test) >= 0.8);
    if (hit) claim(hit.i, field);
  }

  // Everything else becomes a custom field (reusing an existing key when it matches).
  const existing = new Map(existingCustomKeys.map((k) => [customKey(k), k]));
  const taken = new Set<string>();
  for (const c of cols) {
    if (out[c.i]) continue;
    let key = existing.get(customKey(c.h || `column ${c.i + 1}`)) ?? customKey(c.h || `column ${c.i + 1}`);
    for (let n = 2; taken.has(key); n++) key = `${customKey(c.h || `column ${c.i + 1}`)}_${n}`;
    taken.add(key);
    out[c.i] = { kind: "custom", key };
  }
  return out as ColumnMap[];
}

/** "google_rating" → "Google rating" for display. */
export const prettyKey = (k: string) => (k.charAt(0).toUpperCase() + k.slice(1)).replace(/_/g, " ");
