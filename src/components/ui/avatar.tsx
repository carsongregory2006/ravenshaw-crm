import { cn, initials } from "@/lib/utils";

const palette = ["#1961ed", "#7b49e8", "#d1580b", "#1e8c5a", "#c4317f", "#0e7aa6", "#a77b00", "#0f8a78"];
function colorFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return palette[Math.abs(h) % palette.length];
}

export function Avatar({ name, src, size = 20, square, className }: { name?: string | null; src?: string | null; size?: number; square?: boolean; className?: string }) {
  const label = name || "?";
  const style = { width: size, height: size, fontSize: Math.max(9, size * 0.45) };
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={label} style={style} className={cn("shrink-0 object-cover", square ? "rounded-sm" : "rounded-full", className)} />;
  }
  return (
    <span
      style={{ ...style, background: colorFor(label) + "22", color: colorFor(label) }}
      className={cn("inline-flex shrink-0 items-center justify-center font-semibold", square ? "rounded-sm" : "rounded-full", className)}
    >
      {initials(label)}
    </span>
  );
}
