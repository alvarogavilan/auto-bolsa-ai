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

try:
    from zoneinfo import ZoneInfo
    MADRID = ZoneInfo("Europe/Madrid")
    NUEVA_YORK = ZoneInfo("America/New_York")
except Exception:  # sin base de zonas horarias: aproximación de invierno
    MADRID = timezone(timedelta(hours=1))
    NUEVA_YORK = timezone(timedelta(hours=-5))
SLOTS = ["13:00", "16:00", "19:00", "21:30"]           # público hispano (hora de España)
SLOTS_EN = ["18:00", "21:00", "00:30", "02:30"]        # = 12:00, 15:00, 18:30, 20:30 en Nueva York
TAGS_EN = "#GTA6 #GTAVI #gta6clips #gaming #fyp"
HOOKS_EN = ["He did NOT expect this in GTA 6 😂", "GTA 6 went crazy here 💀", "This GTA 6 moment is wild 😳",
            "Nobody expected this in GTA 6 🤯", "GTA 6 is unreal 🔥"]


def load_campaigns() -> dict[str, dict]:
    """@mención del streamer → campaña (nombre, enlace para enviar, idioma)."""
    try:
        cfg = json.loads((HERE / "campanas.seguimiento.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    out = {}
    for c in cfg.get("campanas", []):
        if c.get("permiso") and c.get("mencion"):
            out[c["mencion"].lower()] = {"nombre": c.get("nombre", ""), "url": c["permiso"],
                                         "idioma": c.get("idioma", "es")}
    return out


def captions_en(c: dict, credit: str, i: int) -> dict[str, str]:
    hook = c.get("hook") or ""
    first = (hook.capitalize() + " 😂") if hook and "**" not in hook and len(hook) <= 60 else HOOKS_EN[i % len(HOOKS_EN)]
    who = credit.lstrip("@")
    body = f"{first}\n\n🎥 {credit} (Kick)\n\n{TAGS_EN} #{who}"
    return {"TikTok": body, "YouTube Shorts": body + " #Shorts"}
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


def schedule(n: int, now: datetime, slots: list[str] | None = None) -> list[datetime]:
    slots = slots or SLOTS
    out, day = [], now.astimezone(MADRID).date()
    while len(out) < n:
        for s in slots:
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
    camps = load_campaigns()
    for c in best:
        c["camp"] = camps.get(c["credit"].lower(), {})
    times: list = [None] * len(best)
    for lang, slots in (("es", SLOTS), ("en", SLOTS_EN)):
        idx = [k for k, c in enumerate(best) if (c["camp"].get("idioma") or "es") == lang]
        for k, t in zip(idx, schedule(len(idx), now, slots)):
            times[k] = t
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
        caps = (captions_en(c, c["credit"], i) if (c.get("camp", {}).get("idioma") or "es") == "en"
                else pagina.captions(c, c["credit"]))
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
        en = (c["camp"].get("idioma") or "es") == "en"
        caps = captions_en(c, c["credit"], i) if en else pagina.captions(c, c["credit"])
        hook = c["hook"] if c["hook"] and "**" not in c["hook"] else ""
        w = c["when"].astimezone(MADRID)
        app.append({"rank": i, "archivo": c["asset"], "cuando": c["when"].isoformat(),
                    "cuando_txt": f"{dias[w.weekday()]} {w:%d/%m %H:%M}",
                    "hora_ny": c["when"].astimezone(NUEVA_YORK).strftime("%H:%M") if en else "",
                    "porque": why(c), "gancho": hook, "creador": c["credit"],
                    "campana_nombre": c["camp"].get("nombre", ""), "campana_url": c["camp"].get("url", ""),
                    "tiktok": caps["TikTok"], "shorts": caps["YouTube Shorts"],
                    "avisos": c.get("notes", [])})
    (out / "clips.json").write_text(json.dumps({"generado": now.isoformat(), "clips": app,
                                                 "analizados": len(clips)}, ensure_ascii=False, indent=1),
                                     encoding="utf-8")
    (out / "calendario.ics").write_text(ics(app, now), encoding="utf-8")
    return text


def ics(app: list[dict], now: datetime) -> str:
    """Un aviso al día (12:00, hora de España) con los clips que hay que programar ese día.
    Se publican solos a su hora con la función «Programar» de TikTok y YouTube."""
    def esc(t: str) -> str:
        return t.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")
    stamp = now.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    dias: dict = {}
    for c in app:
        t = datetime.fromisoformat(c["cuando"]).astimezone(MADRID)
        clave = (t - timedelta(hours=6)).date()  # madrugada → se programa el día anterior
        dias.setdefault(clave, []).append(c)
    out = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//GTA 6 Al Dia//Clips//ES", "CALSCALE:GREGORIAN",
           "METHOD:PUBLISH", "X-WR-CALNAME:🎬 Subidas GTA 6 Al Día", "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
           "X-PUBLISHED-TTL:PT1H"]
    for dia, cs in sorted(dias.items()):
        aviso = datetime(dia.year, dia.month, dia.day, 12, 0, tzinfo=MADRID)
        if aviso < now:
            aviso = now + timedelta(minutes=10)
        lista = "\n".join(f"#{c['rank']} → programar para {c['cuando_txt']}"
                          + (f" ({c['hora_ny']} Nueva York)" if c.get("hora_ny") else "") for c in cs)
        a = aviso.astimezone(timezone.utc)
        out += ["BEGIN:VEVENT", f"UID:gta6aldia-plan-{dia:%Y%m%d}@clips", f"DTSTAMP:{stamp}",
                f"DTSTART:{a:%Y%m%dT%H%M%SZ}", f"DTEND:{a + timedelta(minutes=20):%Y%m%dT%H%M%SZ}",
                f"SUMMARY:{esc(f'🎬 Programa {len(cs)} clips de GTA 6 (app GTA 6 Al Día)')}",
                f"DESCRIPTION:{esc('Abre la app y programa cada clip en TikTok y YouTube a su hora:' + chr(10) + lista)}",
                "BEGIN:VALARM", "ACTION:DISPLAY", f"DESCRIPTION:{esc(f'Toca programar {len(cs)} clips')}",
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
