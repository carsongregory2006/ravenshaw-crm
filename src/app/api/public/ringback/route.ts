/** North American ringback (440+480 Hz, 2s on / 4s off) as a WAV, played to inbound callers while the browser rings. */
export const dynamic = "force-static";

export function GET() {
  const rate = 8000, secs = 6, n = rate * secs;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const v = t < 2 ? 0.25 * (Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 480 * t)) : 0;
    buf.writeInt16LE(Math.round(v * 32767 * 0.5), 44 + i * 2);
  }
  return new Response(buf, { headers: { "Content-Type": "audio/wav", "Cache-Control": "public, max-age=86400" } });
}
