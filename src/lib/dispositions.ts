/** One-click call outcomes (PhoneBurner-style). Older values stay so past calls still read well. */
export const DISPOSITIONS = [
  { value: "no_answer", label: "No answer" },
  { value: "voicemail", label: "Left voicemail" },
  { value: "bad_number", label: "Bad number" },
  { value: "not_interested", label: "Not interested" },
  { value: "callback", label: "Call back later" },
  { value: "interested", label: "Interested / Booked" },
] as const;

const LEGACY: Record<string, string> = {
  connected: "Connected", booked: "Booked a meeting", wrong_number: "Wrong number",
};

export function dispositionLabel(value?: string | null) {
  if (!value) return null;
  return DISPOSITIONS.find((d) => d.value === value)?.label ?? LEGACY[value] ?? value.replace(/_/g, " ");
}

export const DISPOSITION_VALUES: string[] = [...DISPOSITIONS.map((d) => d.value), ...Object.keys(LEGACY)];
