"""Órdenes por Telegram: a la hora de cada subida el bot te manda EL VÍDEO + el texto.

Tú solo: abrir el mensaje → compartir el vídeo a TikTok → pegar el texto → publicar.

Se ejecuta cada 10 minutos (GitHub Actions). Lee la cola de la app pública (clips.json),
y para cada clip cuya hora ya ha llegado (hasta 2 h tarde) y que aún no se ha enviado,
manda el vídeo. El chat se detecta solo la primera vez que pulsas «Iniciar» en el bot.
Necesita el secreto TELEGRAM_BOT_TOKEN (y opcionalmente TELEGRAM_CHAT_ID).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

MADRID = ZoneInfo("Europe/Madrid")

APP = os.environ.get("APP_URL", "https://alvarogavilan.github.io/aldiagta6-clips/")
API = "https://api.telegram.org/bot{token}/{method}"
LATE = timedelta(hours=2)


def call(token: str, method: str, fields: dict, file: tuple[str, bytes] | None = None) -> dict:
    url = API.format(token=token, method=method)
    if file is None:
        data = urllib.parse.urlencode(fields).encode()
        req = urllib.request.Request(url, data=data)
    else:
        b = uuid.uuid4().hex
        parts = []
        for k, v in fields.items():
            parts.append(f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
        name, blob = file
        parts.append(f'--{b}\r\nContent-Disposition: form-data; name="video"; filename="{name}"\r\n'
                     f"Content-Type: video/mp4\r\n\r\n".encode() + blob + b"\r\n")
        parts.append(f"--{b}--\r\n".encode())
        req = urllib.request.Request(url, data=b"".join(parts),
                                     headers={"Content-Type": f"multipart/form-data; boundary={b}"})
    with urllib.request.urlopen(req, timeout=120) as r:
        out = json.loads(r.read().decode())
    if not out.get("ok"):
        raise RuntimeError(out.get("description", "error de Telegram"))
    return out["result"]


def find_chat(token: str) -> str:
    """Chat privado de quien pulsó «Iniciar» en el bot (últimas 24 h de mensajes)."""
    for u in reversed(call(token, "getUpdates", {"limit": 100})):
        chat = (u.get("message") or u.get("my_chat_member") or {}).get("chat") or {}
        if chat.get("type") == "private":
            return str(chat["id"])
    return ""


def is_quiet(local: datetime) -> bool:
    """De 00:00 a 08:30 (hora de España) no se manda nada."""
    return local.hour < 8 or (local.hour == 8 and local.minute < 30)


def send_at(t: datetime) -> datetime:
    """De madrugada en España no se despierta a nadie: la orden llega a las 22:30 de la
    noche anterior para dejar el clip PROGRAMADO en TikTok/YouTube."""
    local = t.astimezone(MADRID)
    if is_quiet(local):
        return (local - timedelta(days=1)).replace(hour=22, minute=30, second=0, microsecond=0)
    return t


def due(clips: list[dict], sent: set[str], now: datetime) -> list[dict]:
    out = []
    for c in sorted(clips, key=lambda c: c["cuando"]):
        t = datetime.fromisoformat(c["cuando"])
        key = f"{c['archivo']}@{c['cuando']}"
        if send_at(t) <= now and t >= now - LATE and key not in sent:
            out.append(c)
    return out


def order_text(c: dict) -> str:
    camp = c.get("campana_nombre") or "la campaña"
    t = datetime.fromisoformat(c["cuando"]).astimezone(MADRID)
    send = "Responde a este chat con los 2 enlaces (TikTok y Shorts) y te paso el de la campaña."
    if is_quiet(t):
        return (f"🌙 PROGRAMA AHORA · clip #{c['rank']} para las {t:%H:%M}\n"
                "1️⃣ Toca el vídeo → compartir → TikTok → pega el texto → «Más opciones» → "
                f"Programar → {t:%H:%M} → Programar\n"
                f"2️⃣ YouTube Shorts: igual, en «Visibilidad» → Programar → {t:%H:%M}\n"
                f"3️⃣ {send}")
    return (f"📲 SUBE AHORA · clip #{c['rank']}\n"
            "1️⃣ Toca el vídeo → compartir → TikTok → pega el texto del mensaje siguiente → Publicar\n"
            "2️⃣ Repite en YouTube Shorts (usa el texto de Shorts)\n"
            f"3️⃣ {send}")


LINK = re.compile(r"https?://(?:www\.|vm\.|vt\.|m\.)?(tiktok\.com|youtube\.com|youtu\.be)/\S+", re.I)


def read_links(token: str, chat: str, state: dict, tg=call) -> int:
    """Lee lo que el usuario escribe al bot: enlaces de TikTok/Shorts → se apuntan al último
    clip enviado y el bot responde con el enlace de la campaña para enviarlos."""
    ups = tg(token, "getUpdates", {"offset": state.get("offset", 0) + 1, "limit": 100, "timeout": 0})
    n = 0
    for u in ups:
        state["offset"] = max(state.get("offset", 0), u["update_id"])
        msg = u.get("message") or {}
        if str((msg.get("chat") or {}).get("id")) != chat:
            continue
        links = [m.group(0).rstrip(").,") for m in LINK.finditer(msg.get("text", ""))]
        if not links:
            continue
        pubs = state.setdefault("publicados", {})
        pend = [k for k, v in sorted(pubs.items(), key=lambda kv: kv[1].get("enviado", ""), reverse=True)]
        if not pend:
            continue
        clip = pubs[pend[0]]
        for l in links:
            red = "tiktok" if "tiktok" in l.lower() else "shorts"
            clip.setdefault("enlaces", {})[red] = l
        camp = clip.get("campana_url") or ""
        tg(token, "sendMessage", {"chat_id": chat, "text":
           f"✅ Apuntado el clip #{clip.get('rank')} ({', '.join(clip['enlaces'])}).\n"
           + (f"Último paso: abre la campaña → «Submit» → pega cada enlace:\n{camp}" if camp else "")})
        n += 1
    return n


def update_views(state: dict, now: datetime, run=None) -> int:
    """Cada 6 h mira las vistas reales de cada vídeo publicado (yt-dlp, sin claves)."""
    import shutil
    import subprocess
    if now.timestamp() - state.get("vistas_at", 0) < 6 * 3600:
        return 0
    if run is None:
        if not shutil.which("yt-dlp"):
            return 0
        run = lambda url: subprocess.run(["yt-dlp", "--dump-json", "--skip-download", "--no-warnings", url],  # noqa: E731
                                         capture_output=True, text=True, timeout=90).stdout
    n = 0
    for clip in state.get("publicados", {}).values():
        for red, url in clip.get("enlaces", {}).items():
            try:
                info = json.loads(run(url) or "{}")
            except Exception:
                continue
            if info.get("view_count") is not None:
                clip.setdefault("vistas", {})[red] = int(info["view_count"])
                n += 1
    state["vistas_at"] = now.timestamp()
    return n


def main(argv: list[str] | None = None, tg=call, fetch=None, now: datetime | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--estado", default="estado/telegram.json")
    ap.add_argument("--prueba", action="store_true")
    args = ap.parse_args(argv)
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    if not token:
        print("::error::Falta el secreto TELEGRAM_BOT_TOKEN")
        return 1
    fetch = fetch or (lambda url: urllib.request.urlopen(url, timeout=120).read())
    st = Path(args.estado)
    try:
        state = json.loads(st.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        state = {}
    chat = os.environ.get("TELEGRAM_CHAT_ID", "").strip() or state.get("chat", "") or find_chat(token)
    if not chat:
        print("::error::Abre tu bot en Telegram y pulsa «Iniciar» (o escríbele cualquier cosa).")
        return 1
    state["chat"] = chat
    sent = set(state.get("enviados", []))
    now = now or datetime.now(timezone.utc)
    try:
        if args.prueba:
            tg(token, "sendMessage", {"chat_id": chat, "text":
               "✅ ¡Conectado! A la hora de cada subida te mandaré aquí el vídeo y el texto. "
               "Tú solo compártelo a TikTok y Shorts."})
            print("Mensaje de prueba enviado.")
            return 0
        data = json.loads(fetch(APP + "data/clips.json").decode())
        base = APP + data.get("base", "videos/")
        n = 0
        for c in due(data.get("clips", []), sent, now):
            video = fetch(base + urllib.parse.quote(c["archivo"]))
            tg(token, "sendVideo", {"chat_id": chat, "caption": order_text(c)[:1024],
                                    "supports_streaming": "true"}, (c["archivo"], video))
            tg(token, "sendMessage", {"chat_id": chat, "text": c["tiktok"]})
            if c.get("shorts") and c["shorts"] != c["tiktok"]:
                tg(token, "sendMessage", {"chat_id": chat, "text": "Shorts:\n" + c["shorts"]})
            sent.add(f"{c['archivo']}@{c['cuando']}")
            state.setdefault("publicados", {})[c["archivo"]] = {
                "rank": c["rank"], "enviado": now.isoformat(), "titulo": c["tiktok"].split("\n")[0],
                "ia": c.get("ia_puntuacion"), "campana_url": c.get("campana_url", "")}
            n += 1
        print(f"📲 Telegram: {n} órdenes de subida enviadas.")
        try:
            print(f"🔗 Enlaces apuntados: {read_links(token, chat, state, tg)}")
            print(f"👀 Vistas actualizadas: {update_views(state, now)}")
        except Exception as e:
            print(f"Enlaces/vistas: {type(e).__name__}: {e}")
    finally:
        keep = [k for k in sent if datetime.fromisoformat(k.split("@", 1)[1]) > now - timedelta(days=4)]
        state["enviados"] = sorted(keep)
        state["publicados"] = {k: v for k, v in state.get("publicados", {}).items()
                               if v.get("enviado", "9") > (now - timedelta(days=14)).isoformat()}
        st.parent.mkdir(parents=True, exist_ok=True)
        st.write_text(json.dumps(state), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
