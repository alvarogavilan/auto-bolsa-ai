#!/usr/bin/env python3
"""
Junta los clips de todos los servidores de una ejecución, los ordena de mejor a
peor y prepara la página «Clips listos» (una release de GitHub):

  python publicar.py <carpeta con artifacts clips-gta6-*> --salida publicar/ --top 15

Deja en --salida:
  - 01_...mp4, 02_...mp4…  los mejores clips, renombrados por orden
  - notas.md               ranking, hora y red de subida, textos y gancho sugerido

Puntuación ("equipo de análisis"):
  intensidad del momento (audio + acción)  ×  bonus si el streamer está hablando
  o reaccionando (subtítulos), + bonus por palabras de reacción.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "gta6-pagina"))
import pagina  # noqa: E402
sys.path.insert(0, str(HERE))
import clipper  # noqa: E402

MADRID = timezone(timedelta(hours=1))
SLOTS = ["13:00", "16:00", "19:00", "21:30"]
REACTION = re.compile(r"\b(no way|bro|wtf|oh my god|omg|what|yo+|dude|bruh|holy|let'?s go|nah|crazy|insane|hell)\b", re.I)


def parse_srt(path: Path) -> list[tuple[float, float, str]]:
    if not path.exists():
        return []
    out = []
    for block in path.read_text(encoding="utf-8", errors="ignore").split("\n\n"):
        lines = [l for l in block.strip().splitlines() if l.strip()]
        if len(lines) < 3 or "-->" not in lines[1]:
            continue

        def sec(t: str) -> float:
            h, m, rest = t.strip().split(":")
            s, ms = rest.split(",")
            return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000

        a, b = lines[1].split("-->")
        out.append((sec(a), sec(b), " ".join(lines[2:])))
    return out


def collect(root: Path) -> list[dict]:
    clips = []
    for cj in root.rglob("clips.json"):
        folder = cj.parent
        try:
            data = json.loads(cj.read_text(encoding="utf-8"))
        except ValueError:
            continue
        for c in data:
            mp4 = folder / Path(c.get("file", "")).name
            if not mp4.exists():
                continue
            srt = parse_srt(mp4.with_suffix(".srt"))
            words = " ".join(t for _, _, t in srt)
            n_words = len(words.split())
            reactions = len(REACTION.findall(words))
            peak_rel = float(c.get("peak", 0)) - float(c.get("start", 0))
            near = [t for a, b, t in srt if a - 3 <= peak_rel <= b + 4]
            raw_hook = " ".join(near)
            # nunca proponer como título una frase con insultos; palabrotas censuradas
            hook = "" if clipper.has_slur(raw_hook) else clipper.censor(raw_hook)[:60].strip()
            m = re.search(r"Clip de (@\S+)", c.get("description", ""))
            credit = m.group(1) if m else ""
            speech = min(n_words / 40, 1.0)  # 40+ palabras en el clip = está reaccionando
            rank = float(c.get("score", 0)) * (1 + 0.5 * speech) + 1.5 * min(reactions, 4)
            clips.append({**c, "mp4": mp4, "credit": credit, "hook": hook, "words": n_words,
                          "reactions": reactions, "rank": round(rank, 2), "folder": folder.name})
    clips.sort(key=lambda x: x["rank"], reverse=True)
    return clips


def schedule(n: int, now: datetime) -> list[datetime]:
    out, day = [], now.date()
    while len(out) < n:
        for s in SLOTS:
            h, m = map(int, s.split(":"))
            t = datetime(day.year, day.month, day.day, h, m, tzinfo=MADRID)
            if t > now + timedelta(minutes=20):
                out.append(t)
                if len(out) == n:
                    break
        day += timedelta(days=1)
    return out


def why(c: dict) -> str:
    parts = [f"intensidad {float(c.get('score', 0)):.1f}"]
    if c["words"]:
        parts.append(f"habla {c['words']} palabras")
    if c["reactions"]:
        parts.append(f"{c['reactions']} reacciones")
    return ", ".join(parts)


def build(clips: list[dict], out: Path, top: int, now: datetime) -> str:
    out.mkdir(parents=True, exist_ok=True)
    best = clips[:top]
    times = schedule(len(best), now)
    dias = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]
    md = ["## 📲 Sube en este orden",
          "Toca el nombre del vídeo abajo, en **Assets**, para descargarlo → *Compartir* → *Guardar vídeo*. "
          "Súbelo a **TikTok** a la hora indicada y a **YouTube Shorts** justo después. "
          "Envía cada enlace a la campaña con **«Enviar clip»** nada más publicar.", "",
          "| # | Cuándo | Vídeo | Por qué |", "|---|---|---|---|"]
    for i, (c, t) in enumerate(zip(best, times), 1):
        who = re.sub(r"[^\w-]+", "_", c["credit"].lstrip("@")) or "clip"
        name = f"{i:02d}_{who}_{c['rank']:.0f}.mp4"
        shutil.copy2(c["mp4"], out / name)
        c["asset"], c["when"] = name, t
        md.append(f"| **{i}** | {dias[t.weekday()]} {t:%d/%m %H:%M} | `{name}` | {why(c)} |")
    md += ["", "---", "## ✍️ Textos para copiar (mantén pulsado el recuadro → Copiar)"]
    for i, c in enumerate(best, 1):
        caps = pagina.captions(c, c["credit"])
        md += ["", f"### {i}. `{c['asset']}` · {dias[c['when'].weekday()]} {c['when']:%H:%M}"]
        if c["hook"] and "**" not in c["hook"]:
            md.append(f"💬 Lo que dice en el momento clave: **“{c['hook']}”**. Úsalo como título si encaja.")
        md += ["**TikTok**", "```", caps["TikTok"], "```", "**YouTube Shorts**", "```", caps["YouTube Shorts"], "```"]
        if c.get("notes"):
            md.append(f"> ⚠️ {'; '.join(c['notes'])}")
    md += ["", f"_{len(clips)} clips analizados · se muestran los {len(best)} mejores. "
           "Puntuación automática: intensidad del momento + si el streamer habla o reacciona. "
           "No es una garantía de viralidad._"]
    text = "\n".join(md)
    (out / "notas.md").write_text(text, encoding="utf-8")
    # datos para la app web (una tarjeta por clip)
    app = []
    for i, c in enumerate(best, 1):
        caps = pagina.captions(c, c["credit"])
        hook = c["hook"] if c["hook"] and "**" not in c["hook"] else ""
        app.append({"rank": i, "archivo": c["asset"], "cuando": c["when"].isoformat(),
                    "cuando_txt": f"{dias[c['when'].weekday()]} {c['when']:%d/%m %H:%M}",
                    "porque": why(c), "gancho": hook, "creador": c["credit"],
                    "tiktok": caps["TikTok"], "shorts": caps["YouTube Shorts"],
                    "avisos": c.get("notes", [])})
    (out / "clips.json").write_text(json.dumps({"generado": now.isoformat(), "clips": app,
                                                 "analizados": len(clips)}, ensure_ascii=False, indent=1),
                                     encoding="utf-8")
    (out / "calendario.ics").write_text(ics(app, now), encoding="utf-8")
    return text


def ics(app: list[dict], now: datetime) -> str:
    """Calendario de subidas con aviso a la hora de cada clip (suscribible desde el iPhone)."""
    def esc(t: str) -> str:
        return t.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")
    stamp = now.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//GTA 6 Al Dia//Clips//ES", "CALSCALE:GREGORIAN",
           "METHOD:PUBLISH", "X-WR-CALNAME:🎬 Subidas GTA 6 Al Día", "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
           "X-PUBLISHED-TTL:PT1H"]
    for c in app:
        t = datetime.fromisoformat(c["cuando"]).astimezone(timezone.utc)
        out += ["BEGIN:VEVENT", f"UID:gta6aldia-{c['cuando'][:16].replace(':', '')}-{c['archivo']}@clips", f"DTSTAMP:{stamp}",
                f"DTSTART:{t:%Y%m%dT%H%M%SZ}", f"DTEND:{t + timedelta(minutes=15):%Y%m%dT%H%M%SZ}",
                f"SUMMARY:{esc('🎬 Sube el clip #' + str(c['rank']) + ' (TikTok + Shorts)')}",
                f"DESCRIPTION:{esc('Abre la app GTA 6 Al Día y pulsa «Guardar o enviar a TikTok». Luego envía los enlaces a la campaña.')}",
                "BEGIN:VALARM", "ACTION:DISPLAY", f"DESCRIPTION:{esc('Toca subir el clip #' + str(c['rank']))}",
                "TRIGGER:-PT0M", "END:VALARM", "END:VEVENT"]
    out.append("END:VCALENDAR")
    return "\r\n".join(out) + "\r\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("carpeta")
    ap.add_argument("--salida", default="publicar")
    ap.add_argument("--top", type=int, default=15)
    args = ap.parse_args(argv)
    clips = collect(Path(args.carpeta))
    if not clips:
        print("No hay clips que publicar.")
        return 0
    build(clips, Path(args.salida), args.top, datetime.now(MADRID))
    print(f"✔ {min(len(clips), args.top)} de {len(clips)} clips listos en {args.salida}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
