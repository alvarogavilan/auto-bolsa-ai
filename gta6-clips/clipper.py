#!/usr/bin/env python3
"""
GTA 6 Clipper — convierte tus grabaciones largas de gameplay en clips verticales
(9:16) listos para YouTube Shorts, TikTok e Instagram Reels.

Cómo funciona:
  1. Analiza el audio (picos de volumen respecto al contexto: explosiones,
     persecuciones, gritos, risas) y los cortes de escena (acción rápida).
  2. Puntúa cada medio segundo y elige los N mejores momentos sin solaparse.
  3. Corta cada momento con "pre-roll": el pico cae DESPUÉS del segundo 7
     (YouTube desmonetiza violencia gráfica en los primeros 7 s de un vídeo).
  4. Renderiza en 1080x1920 con fondo difuminado, título, tu @handle,
     audio normalizado a -14 LUFS y (opcional) subtítulos automáticos.
  5. Genera títulos, hashtags y un calendario de publicación (CSV + JSON).

Requisitos: ffmpeg/ffprobe y Python 3.9+ con numpy.
Opcional: `pip install faster-whisper` para subtítulos (--subs).

Ejemplos:
  python clipper.py partida.mp4
  python clipper.py grabaciones/ -n 8 --length 35 --handle @MiCanal --subs
  python clipper.py --watch ~/Capturas --handle @MiCanal     # automático
"""
from __future__ import annotations

import argparse
import csv
import json
import random
import shutil
import subprocess
import sys
import textwrap
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np

VIDEO_EXTS = {".mp4", ".mkv", ".mov", ".webm", ".avi", ".ts"}
HOP = 0.5  # segundos por ventana de análisis
SR = 8000  # sample rate para el análisis de audio


# ---------------------------------------------------------------- utilidades

def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=True, **kw)


def probe_duration(path: Path) -> float:
    out = run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", str(path)],
        capture_output=True, text=True,
    ).stdout.strip()
    return float(out)


def has_audio(path: Path) -> bool:
    out = run(
        ["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries",
         "stream=index", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True,
    ).stdout.strip()
    return bool(out)


def find_font() -> str | None:
    for pattern in ("Inter:bold", "DejaVu Sans:bold", "Arial:bold", "sans:bold"):
        try:
            f = run(["fc-match", "-f", "%{file}", pattern],
                    capture_output=True, text=True).stdout.strip()
            if f and Path(f).exists():
                return f
        except (FileNotFoundError, subprocess.CalledProcessError):
            break
    for f in ("C:/Windows/Fonts/arialbd.ttf", "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
              "/Library/Fonts/Arial Bold.ttf"):
        if Path(f).exists():
            return f
    return None


def zscore(x: np.ndarray) -> np.ndarray:
    sd = x.std()
    return (x - x.mean()) / sd if sd > 1e-9 else np.zeros_like(x)


def smooth(x: np.ndarray, width: int) -> np.ndarray:
    if width <= 1 or len(x) < width:
        return x
    k = np.ones(width) / width
    return np.convolve(x, k, mode="same")


def rolling_median(x: np.ndarray, width: int) -> np.ndarray:
    """Mediana móvil (línea base del volumen) — barata usando bloques."""
    if len(x) == 0:
        return x
    half = width // 2
    pad = np.pad(x, half, mode="edge")
    # submuestreo para que sea rápido en vídeos de horas
    step = max(1, width // 8)
    idx = np.arange(0, len(x), step)
    med = np.array([np.median(pad[i:i + width]) for i in idx])
    return np.interp(np.arange(len(x)), idx, med)


# ------------------------------------------------------------------ análisis

def audio_energy_db(path: Path, duration: float) -> np.ndarray:
    n = int(np.ceil(duration / HOP))
    if not has_audio(path):
        return np.zeros(n)
    raw = run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-vn", "-ac", "1",
         "-ar", str(SR), "-f", "s16le", "-"],
        capture_output=True,
    ).stdout
    samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    win = int(SR * HOP)
    usable = (len(samples) // win) * win
    frames = samples[:usable].reshape(-1, win)
    rms = np.sqrt((frames ** 2).mean(axis=1) + 1e-12)
    db = 20 * np.log10(rms + 1e-9)
    out = np.full(n, db.min() if len(db) else -90.0)
    out[: min(n, len(db))] = db[:n]
    return out


def scene_changes(path: Path, threshold: float) -> list[float]:
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-i", str(path), "-an",
         "-vf", f"scale=320:-2,select='gt(scene,{threshold})',showinfo",
         "-f", "null", "-"],
        capture_output=True, text=True,
    )
    times = []
    for line in proc.stderr.splitlines():
        if "showinfo" in line and "pts_time:" in line:
            try:
                times.append(float(line.split("pts_time:")[1].split()[0]))
            except (IndexError, ValueError):
                pass
    return times


@dataclass
class Clip:
    source: str
    index: int
    peak: float
    start: float
    end: float
    score: float
    file: str = ""
    title: str = ""
    title_en: str = ""
    description: str = ""
    hashtags: str = ""
    publish_at: str = ""
    notes: list[str] = field(default_factory=list)


def score_timeline(path: Path, duration: float, scene_thr: float,
                   audio_w: float, scene_w: float) -> np.ndarray:
    db = audio_energy_db(path, duration)
    n = len(db)
    # "emoción" = cuánto más alto suena que su entorno (60 s), no el volumen absoluto
    baseline = rolling_median(db, int(60 / HOP))
    rel = db - baseline
    spike = np.clip(np.diff(db, prepend=db[:1]), 0, None)  # subidas bruscas
    audio_score = zscore(smooth(rel, 4)) + 0.5 * zscore(smooth(spike, 4))

    cuts = scene_changes(path, scene_thr)
    density = np.zeros(n)
    for t in cuts:
        i = int(t / HOP)
        if 0 <= i < n:
            density[i] += 1
    scene_score = zscore(smooth(density, int(6 / HOP)))

    return smooth(audio_w * audio_score + scene_w * scene_score, 3)


def pick_clips(score: np.ndarray, duration: float, n: int, length: float,
               preroll: float, min_gap: float, source: str,
               min_score: float = 1.0) -> list[Clip]:
    length = min(length, duration)
    order = np.argsort(score)[::-1]
    chosen: list[Clip] = []
    for i in order:
        if len(chosen) >= n or score[i] < min_score:
            break  # mejor menos clips que clips aburridos
        peak = float(i * HOP)
        start = max(0.0, min(peak - preroll, duration - length))
        end = start + length
        if any(start < c.end + min_gap and end > c.start - min_gap for c in chosen):
            continue
        chosen.append(Clip(source, 0, round(peak, 2), round(start, 2),
                           round(end, 2), round(float(score[i]), 3)))
    chosen.sort(key=lambda c: c.start)
    for k, c in enumerate(chosen, 1):
        c.index = k
        if c.peak - c.start < 7.5:
            c.notes.append("pico antes del s7: revisa que no haya violencia gráfica al inicio")
    return chosen


# ---------------------------------------------------------------- metadatos

TITLES_ES = [
    "Esto solo pasa en GTA 6 😳",
    "GTA 6 se pasó con esto 💀",
    "No esperaba esto en GTA 6…",
    "La persecución más loca de GTA 6 🚔",
    "GTA 6 tiene detalles INCREÍBLES 🤯",
    "Vice City en GTA 6 es otro nivel 🌴",
    "Cuando todo sale mal en GTA 6 😂",
    "¿Sabías que en GTA 6 puedes hacer esto?",
]
TITLES_EN = [
    "This only happens in GTA 6 😳",
    "GTA 6 went too far with this 💀",
    "I did NOT expect this in GTA 6…",
    "Craziest police chase in GTA 6 🚔",
    "GTA 6 details are INSANE 🤯",
    "Vice City in GTA 6 hits different 🌴",
    "When everything goes wrong in GTA 6 😂",
    "Did you know you can do this in GTA 6?",
]
BASE_TAGS = ["#GTA6", "#GTAVI", "#GTA", "#GrandTheftAuto", "#ViceCity",
             "#Leonida", "#gaming", "#Shorts"]


def fill_metadata(clips: list[Clip], context: str, handle: str, seed: int) -> None:
    rng = random.Random(seed)
    idx = list(range(len(TITLES_ES)))
    rng.shuffle(idx)
    for k, c in enumerate(clips):
        j = idx[k % len(idx)]
        c.title = (f"{context.strip().capitalize()} en GTA 6 😳" if context and k == 0
                   else TITLES_ES[j])
        c.title_en = TITLES_EN[j]
        c.hashtags = " ".join(BASE_TAGS)
        c.description = (
            f"{c.title}\n\n{('Sígueme ' + handle + ' para más clips de GTA 6 cada día.') if handle else 'Sígueme para más clips de GTA 6 cada día.'}\n"
            f"Gameplay propio grabado en consola. Grand Theft Auto VI © Rockstar Games.\n\n{c.hashtags}"
        )


def schedule(clips: list[Clip], per_day: int, start: datetime, slots: list[str]) -> None:
    day = start.date()
    times = [tuple(map(int, s.split(":"))) for s in slots[:per_day]] or [(18, 0)]
    k = 0
    while k < len(clips):
        for h, m in times:
            if k >= len(clips):
                break
            when = datetime(day.year, day.month, day.day, h, m)
            if when < start:
                continue
            clips[k].publish_at = when.strftime("%Y-%m-%d %H:%M")
            k += 1
        day += timedelta(days=1)


# ----------------------------------------------------------------- render

def ff_escape(text: str) -> str:
    return (text.replace("\\", "\\\\").replace(":", "\\:")
            .replace("'", "\\'").replace("%", "\\%"))


def strip_emoji(text: str) -> str:
    """Las fuentes normales no tienen emojis (saldrían como cuadros)."""
    return "".join(ch for ch in text if ord(ch) < 0x2000 or 0x2010 <= ord(ch) <= 0x206F).strip()


def transcribe_srt(src: Path, clip: Clip, srt_path: Path, model_size: str) -> bool:
    try:
        from faster_whisper import WhisperModel  # type: ignore
    except ImportError:
        print("  [subs] faster-whisper no instalado: pip install faster-whisper", file=sys.stderr)
        return False
    wav = srt_path.with_suffix(".wav")
    run(["ffmpeg", "-v", "error", "-y", "-ss", str(clip.start), "-t", str(clip.end - clip.start),
         "-i", str(src), "-vn", "-ac", "1", "-ar", "16000", str(wav)])
    model = WhisperModel(model_size, device="auto", compute_type="int8")
    segments, _ = model.transcribe(str(wav), word_timestamps=True, vad_filter=True)

    def ts(t: float) -> str:
        ms = int(round(t * 1000))
        return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"

    # bloques cortos de 3 palabras: estilo "subtítulo dinámico" de Shorts/TikTok
    lines, n = [], 0
    for seg in segments:
        words = list(seg.words or [])
        for i in range(0, len(words), 3):
            chunk = words[i:i + 3]
            n += 1
            text = " ".join(w.word.strip() for w in chunk).upper()
            lines.append(f"{n}\n{ts(chunk[0].start)} --> {ts(chunk[-1].end)}\n{text}\n")
    wav.unlink(missing_ok=True)
    if not lines:
        return False
    srt_path.write_text("\n".join(lines), encoding="utf-8")
    return True


def render(src: Path, clip: Clip, out_dir: Path, args, font: str | None) -> None:
    name = f"clip_{clip.index:02d}"
    out = out_dir / f"{name}.mp4"
    W, H = 1080, 1920

    if args.layout == "crop":
        chain = f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1[v0]"
    else:  # blur: juego completo centrado y fondo difuminado (no se pierde el HUD)
        fg_w = int(W * args.zoom) // 2 * 2
        chain = (
            f"[0:v]split=2[a][b];"
            f"[a]scale={W // 4}:{H // 4}:force_original_aspect_ratio=increase,crop={W // 4}:{H // 4},"
            f"gblur=sigma=12,scale={W}:{H},eq=brightness=-0.10:saturation=1.2[bg];"
            f"[b]scale={fg_w}:-2[fg];"
            f"[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v0]"
        )
    last = "v0"
    filters = [chain]

    if font and not args.no_title:
        # una drawtext por línea: centrado fiable en cualquier versión de ffmpeg
        for li, line in enumerate(textwrap.wrap(strip_emoji(clip.title), width=20)[:3]):
            nxt = f"t{li}"
            filters.append(
                f"[{last}]drawtext=fontfile='{ff_escape(font)}':text='{ff_escape(line)}':"
                f"fontsize=72:fontcolor=white:borderw=6:bordercolor=black:"
                f"x=(w-text_w)/2:y={230 + li * 92}[{nxt}]"
            )
            last = nxt
    if font and args.handle:
        filters.append(
            f"[{last}]drawtext=fontfile='{ff_escape(font)}':text='{ff_escape(args.handle)}':"
            f"fontsize=44:fontcolor=white@0.85:borderw=3:bordercolor=black:"
            f"x=(w-text_w)/2:y=h-330[v2]"
        )
        last = "v2"
    if args.subs:
        srt = out_dir / f"{name}.srt"
        if transcribe_srt(src, clip, srt, args.whisper_model):
            style = ("FontName=Inter,FontSize=16,Bold=1,PrimaryColour=&H0000FFFF,"
                     "OutlineColour=&H00000000,BorderStyle=1,Outline=3,Alignment=2,MarginV=70")
            filters.append(f"[{last}]subtitles='{ff_escape(str(srt))}':force_style='{style}'[v3]")
            last = "v3"

    cmd = ["ffmpeg", "-v", "error", "-y", "-ss", f"{clip.start}", "-t", f"{clip.end - clip.start}",
           "-i", str(src), "-filter_complex", ";".join(filters), "-map", f"[{last}]"]
    if has_audio(src):
        cmd += ["-map", "0:a:0", "-af", "loudnorm=I=-14:TP=-1.5:LRA=11",
                "-c:a", "aac", "-b:a", "160k", "-ar", "48000"]
    cmd += ["-c:v", "libx264", "-preset", args.preset, "-crf", "20", "-pix_fmt", "yuv420p",
            "-r", "30", "-movflags", "+faststart", str(out)]
    run(cmd)
    clip.file = str(out)


# ---------------------------------------------------------------- pipeline

def process(src: Path, args, font: str | None) -> list[Clip]:
    duration = probe_duration(src)
    print(f"▶ {src.name}  ({duration / 60:.1f} min) — analizando…")
    score = score_timeline(src, duration, args.scene_threshold, 1.0, args.scene_weight)
    clips = pick_clips(score, duration, args.num, args.length, args.preroll, args.min_gap, str(src),
                       args.min_score)
    fill_metadata(clips, args.context, args.handle, seed=sum(src.name.encode()))
    out_dir = Path(args.out) / src.stem
    out_dir.mkdir(parents=True, exist_ok=True)

    for c in clips:
        print(f"  #{c.index:02d}  {c.start:7.1f}s → {c.end:7.1f}s   pico {c.peak:7.1f}s   score {c.score:5.2f}")
        if not args.dry_run:
            render(src, c, out_dir, args, font)

    write_reports(clips, out_dir)
    return clips


def write_reports(clips: list[Clip], out_dir: Path) -> None:
    rows = [asdict(c) for c in clips]
    (out_dir / "clips.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    with open(out_dir / "clips.csv", "w", newline="", encoding="utf-8") as f:
        cols = ["index", "file", "start", "end", "peak", "score", "publish_at",
                "title", "title_en", "hashtags", "notes"]
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            r = dict(r, notes="; ".join(r["notes"]))
            w.writerow(r)
    prompt = (
        "Eres experto en YouTube Shorts y TikTok de gaming. Para cada clip de GTA 6 abajo, "
        "escribe 3 títulos (máx. 60 caracteres, en español, curiosidad + emoción, sin clickbait falso), "
        "un gancho de texto en pantalla para los 2 primeros segundos y 5 hashtags.\n\n"
        + "\n".join(f"- clip_{c.index:02d}: {c.end - c.start:.0f}s, momento clave en el segundo "
                    f"{c.peak - c.start:.0f}. Describe lo que pasa: ____" for c in clips)
    )
    (out_dir / "prompt_titulos.txt").write_text(prompt, encoding="utf-8")


def collect(inputs: list[str]) -> list[Path]:
    files: list[Path] = []
    for i in inputs:
        p = Path(i).expanduser()
        if p.is_dir():
            files += sorted(f for f in p.iterdir() if f.suffix.lower() in VIDEO_EXTS)
        elif p.is_file():
            files.append(p)
        else:
            print(f"⚠ no existe: {p}", file=sys.stderr)
    return files


def watch(folder: Path, args, font: str | None) -> None:
    done_file = Path(args.out) / ".procesados.txt"
    done = set(done_file.read_text().splitlines()) if done_file.exists() else set()
    print(f"👀 Vigilando {folder} — deja ahí tus grabaciones (Ctrl+C para salir)")
    sizes: dict[Path, int] = {}
    while True:
        for f in sorted(folder.iterdir()):
            if f.suffix.lower() not in VIDEO_EXTS or str(f) in done:
                continue
            size = f.stat().st_size
            if sizes.get(f) != size:  # aún se está copiando/grabando
                sizes[f] = size
                continue
            try:
                all_clips = process(f, args, font)
                schedule(all_clips, args.per_day, datetime.now() + timedelta(hours=1), args.slots)
                write_reports(all_clips, Path(args.out) / f.stem)
            except subprocess.CalledProcessError as e:
                print(f"✖ error con {f.name}: {e}", file=sys.stderr)
            done.add(str(f))
            done_file.parent.mkdir(parents=True, exist_ok=True)
            done_file.write_text("\n".join(sorted(done)))
        time.sleep(args.poll)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Clips verticales automáticos de GTA 6 para Shorts/TikTok/Reels")
    ap.add_argument("inputs", nargs="*", help="vídeos o carpetas con grabaciones")
    ap.add_argument("-n", "--num", type=int, default=6, help="clips por vídeo (6)")
    ap.add_argument("--length", type=float, default=30, help="duración de cada clip en s (30)")
    ap.add_argument("--preroll", type=float, default=9, help="segundos antes del pico (9; >7 por la regla de YouTube)")
    ap.add_argument("--min-gap", type=float, default=20, help="separación mínima entre clips en s")
    ap.add_argument("--min-score", type=float, default=1.0, help="umbral de emoción (1.0); bájalo si salen pocos clips")
    ap.add_argument("--layout", choices=["blur", "crop"], default="blur")
    ap.add_argument("--zoom", type=float, default=1.0, help="ancho del juego en modo blur (1.0=1080px; 1.4 = más grande, recorta lados)")
    ap.add_argument("--handle", default="", help="tu @usuario, se dibuja abajo")
    ap.add_argument("--context", default="", help="tema del vídeo para el primer título, p.ej. 'persecución policial'")
    ap.add_argument("--no-title", action="store_true", help="no dibujar el título en el vídeo")
    ap.add_argument("--subs", action="store_true", help="subtítulos automáticos (requiere faster-whisper)")
    ap.add_argument("--whisper-model", default="small")
    ap.add_argument("--scene-threshold", type=float, default=0.35)
    ap.add_argument("--scene-weight", type=float, default=0.6)
    ap.add_argument("--per-day", type=int, default=3, help="publicaciones al día para el calendario")
    ap.add_argument("--slots", nargs="+", default=["13:00", "18:00", "21:30"], help="horas de publicación")
    ap.add_argument("--preset", default="veryfast", help="preset x264")
    ap.add_argument("--out", default="salida", help="carpeta de salida")
    ap.add_argument("--dry-run", action="store_true", help="solo analiza, no renderiza")
    ap.add_argument("--watch", metavar="CARPETA", help="procesa automáticamente cada vídeo nuevo")
    ap.add_argument("--poll", type=float, default=20, help="segundos entre comprobaciones en --watch")
    args = ap.parse_args(argv)

    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        print("✖ Necesitas ffmpeg instalado (https://ffmpeg.org/download.html)", file=sys.stderr)
        return 1
    font = find_font()
    if not font:
        print("⚠ No encontré fuente TTF: los vídeos saldrán sin título/handle", file=sys.stderr)

    if args.watch:
        watch(Path(args.watch).expanduser(), args, font)
        return 0

    files = collect(args.inputs)
    if not files:
        ap.print_help()
        return 1
    all_clips: list[Clip] = []
    for f in files:
        all_clips += process(f, args, font)
    schedule(all_clips, args.per_day, datetime.now() + timedelta(hours=1), args.slots)
    # reescribe informes con el calendario global
    for f in files:
        write_reports([c for c in all_clips if c.source == str(f)], Path(args.out) / f.stem)
    print(f"\n✔ {len(all_clips)} clips en '{args.out}/'. Revisa clips.csv para títulos y horario.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
