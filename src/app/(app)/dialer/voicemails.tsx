"use client";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Mic, Pause, Play, Square, Upload } from "lucide-react";
import { Card } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { saveVoicemailAction, voicemailUploadUrlAction, voicemailUrlAction } from "@/lib/actions/dialer";
import { fmtSecs } from "@/lib/dialer/stats";
import type { VoicemailDrop } from "@/lib/types";

function audioDuration(blob: Blob): Promise<number | null> {
  return new Promise((res) => {
    const a = new Audio(URL.createObjectURL(blob));
    a.onloadedmetadata = () => res(isFinite(a.duration) ? a.duration : null);
    a.onerror = () => res(null);
  });
}

/** Record or upload voicemail drops. */
export function VoicemailManager({ voicemails, onChanged }: { voicemails: VoicemailDrop[]; onChanged: () => void }) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const started = useRef(0);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setElapsed((Date.now() - started.current) / 1000), 250);
    return () => clearInterval(t);
  }, [recording]);

  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = () => { stream.getTracks().forEach((t) => t.stop()); setBlob(new Blob(chunks, { type: r.mimeType || "audio/webm" })); };
      rec.current = r;
      started.current = Date.now();
      setElapsed(0);
      setBlob(null);
      r.start();
      setRecording(true);
    } catch {
      toast.error("Microphone access is needed to record");
    }
  };
  const stopRec = () => { rec.current?.stop(); setRecording(false); };

  const save = async () => {
    if (!blob) return;
    setSaving(true);
    try {
      const ext = blob.type.includes("mpeg") ? "mp3" : blob.type.includes("wav") ? "wav" : blob.type.includes("mp4") || blob.type.includes("m4a") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
      const u = await voicemailUploadUrlAction(ext);
      if (!u.ok) throw new Error(u.error);
      const { error } = await createClient().storage.from("voicemails").uploadToSignedUrl(u.data.path, u.data.token, blob, { contentType: blob.type || undefined });
      if (error) throw new Error(error.message);
      const s = await saveVoicemailAction({ name: name || `Voicemail ${voicemails.length + 1}`, path: u.data.path, durationSec: await audioDuration(blob) });
      if (!s.ok) throw new Error(s.error);
      toast.success("Voicemail saved");
      setBlob(null);
      setName("");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setSaving(false);
    }
  };

  const play = async (v: VoicemailDrop) => {
    if (playing === v.id) { player.current?.pause(); setPlaying(null); return; }
    const r = await voicemailUrlAction(v.id);
    if (!r.ok) return toast.error(r.error);
    player.current?.pause();
    const a = new Audio(r.data.url);
    a.onended = () => setPlaying(null);
    player.current = a;
    a.play();
    setPlaying(v.id);
  };

  return (
    <Card title="Voicemail drops">
      <div className="space-y-2">
        {voicemails.map((v) => (
          <div key={v.id} className="flex items-center gap-2 text-[13px]">
            <Button size="xs" variant="ghost" icon={playing === v.id ? Pause : Play} onClick={() => play(v)} aria-label="Play" />
            <span className="flex-1 truncate">{v.name}</span>
            <span className="text-xs text-fg-3">{fmtSecs(v.duration_sec)}</span>
          </div>
        ))}
        {!voicemails.length && <p className="text-xs text-fg-3">Record a short message once; drop it on any voicemail with one click.</p>}
        <div className="flex items-center gap-1.5 border-t border-border-light pt-2">
          {recording
            ? <Button size="sm" variant="danger" icon={Square} onClick={stopRec}>Stop · {fmtSecs(elapsed)}</Button>
            : <Button size="sm" icon={Mic} onClick={startRec}>Record</Button>}
          <label className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md px-2 text-xs text-fg-2 hover:bg-hover">
            <Upload className="size-3.5" /> Upload audio
            <input type="file" accept="audio/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setBlob(f); if (!name) setName(f.name.replace(/\.[^.]+$/, "")); } }} />
          </label>
        </div>
        {blob && !recording && (
          <div className="space-y-1.5 rounded-md bg-bg-2 p-2">
            <audio controls src={URL.createObjectURL(blob)} className="h-8 w-full" />
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Intro VM — landscapers" />
            <div className="flex justify-end gap-1.5">
              <Button size="sm" onClick={() => setBlob(null)}>Discard</Button>
              <Button size="sm" variant="primary" loading={saving} onClick={save}>Save voicemail</Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
