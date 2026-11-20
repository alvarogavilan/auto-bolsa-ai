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
import sys
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

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


def due(clips: list[dict], sent: set[str], now: datetime) -> list[dict]:
    out = []
    for c in sorted(clips, key=lambda c: c["cuando"]):
        t = datetime.fromisoformat(c["cuando"])
        key = f"{c['archivo']}@{c['cuando']}"
        if now - LATE <= t <= now and key not in sent:
            out.append(c)
    return out


def order_text(c: dict) -> str:
    camp = c.get("campana_nombre") or "la campaña"
    return (f"📲 SUBE AHORA · clip #{c['rank']}\n"
            "1️⃣ Toca el vídeo → compartir → TikTok → pega el texto del mensaje siguiente → Publicar\n"
            "2️⃣ Repite en YouTube Shorts (usa el texto de Shorts)\n"
            f"3️⃣ Abre la app → pega los 2 enlaces → «Enviar a esta campaña» ({camp})\n{APP}")


def main(argv: list[str] | None = None, tg=call, fetch=None) -> int:
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
    now = datetime.now(timezone.utc)
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
            n += 1
        print(f"📲 Telegram: {n} órdenes de subida enviadas.")
    finally:
        keep = [k for k in sent if datetime.fromisoformat(k.split("@", 1)[1]) > now - timedelta(days=4)]
        state["enviados"] = sorted(keep)
        st.parent.mkdir(parents=True, exist_ok=True)
        st.write_text(json.dumps(state), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
