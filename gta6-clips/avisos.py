"""Avisos push gratis al móvil con ntfy (app «ntfy» en el iPhone, sin cuenta).

- Nada más publicar una tanda: «🎬 N clips nuevos listos» (ser los primeros en subir).
- 5 minutos antes de cada hora de subida: «⏰ Sube un clip ahora». Al tocarlo se abre la app.

El canal (NTFY_TOPIC) es un secreto de GitHub: quien no lo sepa no puede leer ni enviar avisos.
Las horas ya avisadas se guardan en estado/avisos.json para no repetir avisos entre tandas.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

NTFY = os.environ.get("NTFY_URL", "https://ntfy.sh")
MAX_AHEAD = timedelta(hours=70)  # ntfy guarda avisos programados hasta 3 días
APP = os.environ.get("APP_URL", "https://alvarogavilan.github.io/aldiagta6-clips/")


def send(topic: str, title: str, message: str, delay: int | None = None, priority: int = 4,
         tags: list[str] | None = None) -> None:
    body = {"topic": topic, "title": title, "message": message, "priority": priority,
            "click": APP, "tags": tags or []}
    if delay:
        body["delay"] = str(delay)  # marca de tiempo unix
    req = urllib.request.Request(NTFY, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        r.read()


def plan(clips: list[dict], done: set[str], now: datetime) -> list[tuple[datetime, dict]]:
    """Horas de subida futuras (≤ 70 h) que aún no tienen aviso."""
    out = []
    for c in clips:
        t = datetime.fromisoformat(c["cuando"])
        if t - timedelta(minutes=5) > now + timedelta(minutes=2) and t <= now + MAX_AHEAD and t.isoformat() not in done:
            out.append((t, c))
    return out


def main(argv: list[str] | None = None, sender=send) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("clips_json")
    ap.add_argument("--estado", default="estado/avisos.json")
    args = ap.parse_args(argv)
    topic = os.environ.get("NTFY_TOPIC", "").strip()
    if not topic:
        print("Avisos push desactivados (falta el secreto NTFY_TOPIC).")
        return 0
    data = json.loads(Path(args.clips_json).read_text(encoding="utf-8"))
    clips = data.get("clips", [])
    now = datetime.now(timezone.utc)
    st = Path(args.estado)
    try:
        done = set(json.loads(st.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        done = set()
    done = {d for d in done if datetime.fromisoformat(d) > now - timedelta(days=1)}
    try:
        if clips:
            top = clips[0]
            nota = f" · 🧠 {top['ia_puntuacion']}/100" if top.get("ia_puntuacion") is not None else ""
            sender(topic, f"🎬 {len(clips)} clips nuevos de GTA 6 listos",
                   f"El mejor: #{top['rank']}{nota}. Abre la app y programa los de hoy antes que nadie.",
                   tags=["clapper"])
        n = 0
        for t, c in plan(clips, done, now):
            camp = f" · campaña {c['campana_nombre']}" if c.get("campana_nombre") else ""
            ny = f" ({c['hora_ny']} Nueva York)" if c.get("hora_ny") else ""
            sender(topic, "⏰ En 5 min: sube un clip de GTA 6",
                   f"Toca para abrir la app: el clip que toca a las {c['cuando_txt'][-5:]}{ny} está arriba{camp}. "
                   "Súbelo a TikTok y a Shorts y envía los enlaces a la campaña.",
                   delay=int((t - timedelta(minutes=5)).timestamp()), priority=5, tags=["alarm_clock"])
            done.add(t.isoformat())
            n += 1
        print(f"🔔 Avisos push: 1 de tanda nueva + {n} recordatorios programados.")
    except Exception as e:  # los avisos nunca rompen la publicación
        print(f"No se pudieron enviar los avisos ({type(e).__name__}: {e}).")
    st.parent.mkdir(parents=True, exist_ok=True)
    st.write_text(json.dumps(sorted(done)), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
