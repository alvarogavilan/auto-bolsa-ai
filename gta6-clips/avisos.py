"""Avisos push gratis al móvil con ntfy (app «ntfy» en el iPhone, sin cuenta).

Solo avisa cuando hay que HACER algo: a la hora exacta de cada subida llega
«📲 Sube AHORA el clip #N» con la orden concreta. Al tocarlo se abre la app con ese clip arriba.

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
        resp = json.loads(r.read().decode() or "{}")
    print(f"  ntfy aceptó el aviso (id {resp.get('id', '?')}) para {datetime.fromtimestamp(delay or resp.get('time', 0), timezone.utc):%d/%m %H:%M} UTC")


def plan(clips: list[dict], done: set[str], now: datetime) -> list[tuple[datetime, dict]]:
    """Horas de subida futuras (≤ 70 h) que aún no tienen aviso."""
    out = []
    for c in clips:
        t = datetime.fromisoformat(c["cuando"])
        if t > now + timedelta(minutes=2) and t <= now + MAX_AHEAD and t.isoformat() not in done:
            out.append((t, c))
    return out


def main(argv: list[str] | None = None, sender=send) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("clips_json")
    ap.add_argument("--estado", default="estado/avisos.json")
    ap.add_argument("--prueba", action="store_true", help="manda un aviso de prueba ya")
    args = ap.parse_args(argv)
    topic = os.environ.get("NTFY_TOPIC", "").strip()
    if not topic:
        print("Avisos push desactivados (falta el secreto NTFY_TOPIC).")
        return 0
    if args.prueba:
        sender(topic, "✅ Avisos de GTA 6 funcionando",
               "Así te avisaré a la hora exacta de cada subida. Toca para abrir la app.", tags=["white_check_mark"])
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
        n = 0
        for t, c in plan(clips, done, now):
            camp = f" · campaña {c['campana_nombre']}" if c.get("campana_nombre") else ""
            ny = f" ({c['hora_ny']} Nueva York)" if c.get("hora_ny") else ""
            sender(topic, f"📲 Sube AHORA el clip #{c['rank']}",
                   f"Toca aquí → «Guardar o enviar a TikTok» → pega el texto → Publicar. "
                   f"Luego súbelo a YouTube Shorts y envía los 2 enlaces{camp}.",
                   delay=int(t.timestamp()), priority=5, tags=["iphone"])
            done.add(t.isoformat())
            n += 1
        print(f"🔔 Avisos push: {n} órdenes de subida programadas.")
    except Exception as e:  # los avisos nunca rompen la publicación
        print(f"No se pudieron enviar los avisos ({type(e).__name__}: {e}).")
    st.parent.mkdir(parents=True, exist_ok=True)
    st.write_text(json.dumps(sorted(done)), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
