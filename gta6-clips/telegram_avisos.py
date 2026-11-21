"""Plan diario por Telegram: UNA sesión de ~15 min por la mañana y nada más en todo el día.

A las 9:00 (hora de España) el bot manda:
  1. «Pega aquí los enlaces de ayer»: se los pegas todos juntos, en cualquier orden. El bot
     reconoce cada vídeo por su texto y te devuelve la lista lista para la campaña.
  2. El plan del día: los mejores clips, cada uno con SU VÍDEO + texto + la hora a la que
     PROGRAMARLO en TikTok y en YouTube Shorts. Se publican solos a esa hora.
Si a las 9:00 aún no hay clips nuevos, el plan llega en cuanto los haya (nunca de 00:00 a 08:30).

Se ejecuta cada 10 minutos (GitHub Actions). Además mide las vistas reales cada 6 h, que la IA
usa para aprender qué funciona en tu cuenta. Necesita el secreto TELEGRAM_BOT_TOKEN.
"""
from __future__ import annotations

import argparse
import difflib
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
PLAN_AT = (9, 0)  # hora del plan diario (España)
MIN_IA = 50  # calidad mínima: mejor 2 clips buenos que 4 flojos (muchas campañas no pagan < 1.000 vistas)
# horas de publicación por público (hora de España); deben coincidir con publicar.py
SLOTS = {"es": ["13:00", "16:00", "19:00", "21:30"],
         "en": ["16:00", "18:00", "21:00", "00:30", "02:30"]}  # EE. UU.: 10:00, 12:00, 15:00, 18:30, 20:30 NY
LINK = re.compile(r"https?://(?:www\.|vm\.|vt\.|m\.)?(tiktok\.com|youtube\.com|youtu\.be|instagram\.com)/\S+", re.I)


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


def day_slots(lang: str, day, now: datetime) -> list[datetime]:
    """Horas de un «día de plan» (de 9:00 a 9:00 del día siguiente) que aún no han pasado."""
    out = []
    for s in SLOTS.get(lang, SLOTS["es"]):
        h, m = map(int, s.split(":"))
        d = day + timedelta(days=1) if (h, m) < PLAN_AT else day
        t = datetime(d.year, d.month, d.day, h, m, tzinfo=MADRID)
        if t > now + timedelta(minutes=30):
            out.append(t)
    return out


def make_plan(clips: list[dict], planned: set[str], now: datetime) -> list[tuple[dict, datetime]]:
    """Los mejores clips aún no planificados → las horas de hoy, por idioma de la campaña."""
    local = now.astimezone(MADRID)
    day = local.date() if (local.hour, local.minute) >= PLAN_AT else local.date() - timedelta(days=1)
    plan = []
    for lang in ("en", "es"):
        ok = [c for c in sorted(clips, key=lambda c: c["rank"])
              if c["archivo"] not in planned and (("en" if c.get("hora_ny") else "es") == lang)
              and (c.get("ia_puntuacion") is None or c["ia_puntuacion"] >= MIN_IA)]
        groups: dict = {}
        for c in ok:
            groups.setdefault(c.get("campana_nombre", ""), []).append(c)
        cands, lists = [], list(groups.values())
        while any(lists):  # por turnos entre campañas: cada una recibe sus horas
            for g in lists:
                if g:
                    cands.append(g.pop(0))
        plan += list(zip(cands, day_slots(lang, day, now)))
    return sorted(plan, key=lambda p: p[1])


def plan_text(c: dict, t: datetime, i: int, n: int, auto_ig: bool = False) -> str:
    ny = t.astimezone(ZoneInfo("America/New_York"))
    when = f"{t:%H:%M}" + (" de esta madrugada" if t.hour < 9 else "") + (f" ({ny:%H:%M} NY)" if c.get("hora_ny") else "")
    nota = f" · 🧠 {c['ia_puntuacion']}/100" if c.get("ia_puntuacion") is not None else ""
    camp = f"🎯 Campaña: {c['campana_nombre']}\n" if c.get("campana_nombre") else ""
    ig = ""
    if "instagram" in c.get("plataformas", []):
        ig = (f"\nInstagram: ✅ se publica SOLO a las {t:%H:%M} (no hagas nada)" if auto_ig else
              "\nInstagram: compartir → Instagram → Reel → pega el 1.er texto → Opciones avanzadas → "
              f"Programar → {t:%H:%M}")
    return (f"📅 {i}/{n} · PROGRAMA para las {when}{nota}\n{camp}"
            f"TikTok: compartir el vídeo → TikTok → pega el 1.er texto → «Más opciones» → Programar → {t:%H:%M}\n"
            f"Shorts: compartir → YouTube → pega el 2.º texto → Visibilidad → Programar → {t:%H:%M}{ig}")


def match_clip(link: str, pubs: dict, info: dict) -> str | None:
    """Reconoce de qué clip es un enlace por el texto del vídeo (título/descripción)."""
    text = " ".join(str(info.get(k, "")) for k in ("title", "description", "fulltitle")).lower()
    best, score = None, 0.0
    for key, p in pubs.items():
        ref = (p.get("titulo") or "").lower()
        if not ref:
            continue
        s = 1.0 if ref[:40] and ref[:40] in text else difflib.SequenceMatcher(None, ref, text[:len(ref) + 40]).ratio()
        if s > score:
            best, score = key, s
    return best if score >= 0.5 else None


def read_links(token: str, chat: str, state: dict, tg=None, probe=None) -> int:
    """Enlaces que pegas al bot → se apuntan a su clip y te devuelve la lista para la campaña."""
    tg = tg or call
    ups = tg(token, "getUpdates", {"offset": state.get("offset", 0) + 1, "limit": 100, "timeout": 0})
    pubs = state.setdefault("publicados", {})
    got = []
    for u in ups or []:
        state["offset"] = max(state.get("offset", 0), u["update_id"])
        msg = u.get("message") or {}
        if str((msg.get("chat") or {}).get("id")) != chat:
            continue
        got += [m.group(0).rstrip(").,") for m in LINK.finditer(msg.get("text", ""))]
    if not got or not pubs:
        return 0
    probe = probe or _probe
    waiting = [k for k, p in sorted(pubs.items(), key=lambda kv: kv[1].get("hora", "")) if len(p.get("enlaces", {})) < p.get("n_redes", 2)]
    info_ok, avisos = {}, []
    for link in got:
        low = link.lower()
        red = "tiktok" if "tiktok" in low else "instagram" if "instagram" in low else "shorts"
        info = probe(link)
        info_ok[link] = bool(info) or probe is not _probe or not _has_ytdlp()
        key = match_clip(link, pubs, info)
        if key is None:  # sin texto reconocible: al primer clip al que le falte esa red
            key = next((k for k in waiting if red not in pubs[k].get("enlaces", {})), None)
        if key:
            pubs[key].setdefault("enlaces", {})[red] = link
        if not info_ok.get(link, True):
            avisos.append(link)
    camps: dict = {}
    for p in pubs.values():
        for l in p.get("enlaces", {}).values():
            if not p.get("enviado_campana"):
                camps.setdefault(p.get("campana_url", ""), []).append(l)
    lines = ["✅ Apuntados. Último paso: abre la campaña → «Submit» → pega cada enlace:"]
    for url, links in camps.items():
        lines += ["", url or "(campaña)"] + [f"• {l}" for l in links]
    for p in pubs.values():
        if len(p.get("enlaces", {})) >= p.get("n_redes", 2):
            p["enviado_campana"] = True
    faltan = [str(p["rank"]) for p in pubs.values() if p.get("hora", "") < datetime.now(timezone.utc).isoformat()
              and len(p.get("enlaces", {})) < p.get("n_redes", 2)]
    if avisos:
        lines.append("\n⚠️ Estos no se pueden ver desde fuera: comprueba que son PÚBLICOS antes de enviarlos "
                     "(un vídeo privado o borrado se rechaza):\n" + "\n".join(f"• {l}" for l in avisos))
    if faltan:
        lines.append(f"\nAún me faltan enlaces de los clips #{', #'.join(faltan)}.")
    tg(token, "sendMessage", {"chat_id": chat, "text": "\n".join(lines), "disable_web_page_preview": "true"})
    return len(got)


def _has_ytdlp() -> bool:
    import shutil
    return bool(shutil.which("yt-dlp"))


def _probe(url: str) -> dict:
    import shutil
    import subprocess
    if not shutil.which("yt-dlp"):
        return {}
    try:
        out = subprocess.run(["yt-dlp", "--dump-json", "--skip-download", "--no-warnings", url],
                             capture_output=True, text=True, timeout=90).stdout
        return json.loads(out or "{}")
    except Exception:
        return {}


IG_API = "https://graph.instagram.com"


def ig_call(method: str, path: str, params: dict) -> dict:
    """Instagram API (con inicio de sesión de Instagram), sin librerías externas."""
    data = urllib.parse.urlencode(params).encode()
    if method == "GET":
        req = urllib.request.Request(f"{IG_API}/{path}?{data.decode()}")
    else:
        req = urllib.request.Request(f"{IG_API}/{path}", data=data)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


class Instagram:
    """Publica Reels solo: el contenedor se crea a las 9:00 (Instagram baja el vídeo entonces)
    y se publica a su hora con un solo clic del robot. Los contenedores duran 24 h."""

    def __init__(self, token: str, api=ig_call):
        self.token, self.api = token, api
        self.user = str(api("GET", "me", {"fields": "user_id,username", "access_token": token}).get("user_id", ""))

    def prepare(self, video_url: str, caption: str) -> str:
        return self.api("POST", f"{self.user}/media", {"media_type": "REELS", "video_url": video_url,
                                                        "caption": caption[:2200], "share_to_feed": "true",
                                                        "access_token": self.token})["id"]

    def status(self, cid: str) -> str:
        return self.api("GET", cid, {"fields": "status_code", "access_token": self.token}).get("status_code", "")

    def publish(self, cid: str) -> str:
        mid = self.api("POST", f"{self.user}/media_publish", {"creation_id": cid, "access_token": self.token})["id"]
        return self.api("GET", mid, {"fields": "permalink", "access_token": self.token}).get("permalink", "")

    def refresh(self) -> None:
        self.api("GET", "refresh_access_token", {"grant_type": "ig_refresh_token", "access_token": self.token})


def run_instagram(ig: "Instagram", state: dict, now: datetime, tg, token: str, chat: str) -> int:
    """Publica los Reels cuya hora ha llegado. Si algo falla, avisa una vez para subirlo a mano."""
    n, keep = 0, []
    pubs = state.setdefault("publicados", {})
    for item in state.get("ig_cola", []):
        if datetime.fromisoformat(item["hora"]) > now:
            keep.append(item)
            continue
        try:
            st = ig.status(item["id"])
            if st == "IN_PROGRESS" and now - datetime.fromisoformat(item["hora"]) < timedelta(hours=1):
                keep.append(item)  # Instagram aún procesa el vídeo: se reintenta en 10 min
                continue
            if st != "FINISHED":
                raise RuntimeError(f"estado {st or 'desconocido'}")
            link = ig.publish(item["id"])
            pubs.setdefault(item["archivo"], {}).setdefault("enlaces", {})["instagram"] = link
            n += 1
        except Exception as e:
            tg(token, "sendMessage", {"chat_id": chat, "text":
               f"⚠️ Instagram no pudo publicar solo el clip #{item.get('rank')} ({type(e).__name__}). "
               "Súbelo tú a Reels con el vídeo del plan de hoy."})
    state["ig_cola"] = keep
    return n


def update_views(state: dict, now: datetime, run=None) -> int:
    """Cada 6 h mira las vistas reales de cada vídeo publicado (yt-dlp, sin claves)."""
    import shutil
    if now.timestamp() - state.get("vistas_at", 0) < 6 * 3600:
        return 0
    if run is None and not shutil.which("yt-dlp"):
        return 0
    n = 0
    for clip in state.get("publicados", {}).values():
        for red, url in clip.get("enlaces", {}).items():
            try:
                info = json.loads(run(url)) if run else _probe(url)
            except Exception:
                continue
            if info.get("view_count") is not None:
                clip.setdefault("vistas", {})[red] = int(info["view_count"])
                n += 1
    state["vistas_at"] = now.timestamp()
    return n




def main(argv: list[str] | None = None, tg=call, fetch=None, now: datetime | None = None, probe=None,
         ig_api=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--estado", default="estado/telegram.json")
    ap.add_argument("--prueba", action="store_true")
    ap.add_argument("--mensaje", default="", help="tarea puntual para el usuario (se envía tal cual)")
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
    now = now or datetime.now(timezone.utc)
    local = now.astimezone(MADRID)
    try:
        if args.mensaje.strip():
            tg(token, "sendMessage", {"chat_id": chat, "text": args.mensaje.replace("\\n", "\n"),
                                      "disable_web_page_preview": "true"})
            print("Tarea enviada.")
            return 0
        if args.prueba:
            tg(token, "sendMessage", {"chat_id": chat, "text":
               "✅ ¡Conectado! Cada mañana a las 9:00 te mando aquí el plan del día completo."})
            print("Mensaje de prueba enviado.")
            return 0
        print(f"🔗 Enlaces apuntados: {read_links(token, chat, state, tg, probe)}")
        ig = None
        if os.environ.get("INSTAGRAM_TOKEN", "").strip():
            try:
                ig = Instagram(os.environ["INSTAGRAM_TOKEN"].strip(), ig_api or ig_call)
                if now.timestamp() - state.get("ig_refresh", 0) > 7 * 86400:
                    ig.refresh()  # alarga la vida de la llave (caduca a los 60 días sin uso)
                    state["ig_refresh"] = now.timestamp()
            except Exception as e:
                ig = None
                if now.timestamp() - state.get("ig_aviso", 0) > 86400:
                    state["ig_aviso"] = now.timestamp()
                    tg(token, "sendMessage", {"chat_id": chat, "text":
                       f"⚠️ La llave de Instagram no funciona ({type(e).__name__}). Hasta que la renueves, "
                       "súbelo a Reels a mano con el plan. Escríbeme a Claude «renovar Instagram»."})
        if ig:
            print(f"📸 Reels publicados solos: {run_instagram(ig, state, now, tg, token, chat)}")
        today = local.date().isoformat()
        if (local.hour, local.minute) >= PLAN_AT and local.hour < 23 and state.get("plan_dia") != today:
            data = json.loads(fetch(APP + "data/clips.json").decode())
            base = APP + data.get("base", "videos/")
            planned = set(state.get("planificados", []))
            plan = make_plan(data.get("clips", []), planned, now)
            if plan:
                pubs = state.setdefault("publicados", {})
                ayer = [str(p["rank"]) for p in pubs.values() if p.get("hora", "") < now.isoformat()
                        and len(p.get("enlaces", {})) < p.get("n_redes", 2)]
                intro = [f"☀️ Plan de hoy: {len(plan)} clips · unos {5 + 2 * len(plan)} min y listo hasta mañana."]
                if ayer:
                    intro.append("1️⃣ Pega aquí (en un solo mensaje) los enlaces de TikTok y Shorts de lo que se "
                                 "publicó ayer: te devuelvo la lista para la campaña.")
                intro.append(("2️⃣" if ayer else "1️⃣") + " Programa cada vídeo de abajo a su hora:")
                intro += [f"   • {t:%H:%M} → clip #{c['rank']}" for c, t in plan]
                tg(token, "sendMessage", {"chat_id": chat, "text": "\n".join(intro)})
                for i, (c, t) in enumerate(plan, 1):
                    video = fetch(base + urllib.parse.quote(c["archivo"]))
                    auto_ig = False
                    if ig and "instagram" in c.get("plataformas", []):
                        try:
                            cid = ig.prepare(base + urllib.parse.quote(c["archivo"]), c["tiktok"])
                            state.setdefault("ig_cola", []).append(
                                {"id": cid, "hora": t.isoformat(), "archivo": c["archivo"], "rank": c["rank"]})
                            auto_ig = True
                        except Exception as e:
                            print(f"Instagram: no pude preparar el clip #{c['rank']}: {e}")
                    tg(token, "sendVideo", {"chat_id": chat, "caption": plan_text(c, t, i, len(plan), auto_ig)[:1024],
                                            "supports_streaming": "true"}, (c["archivo"], video))
                    tg(token, "sendMessage", {"chat_id": chat, "text": c["tiktok"]})
                    tg(token, "sendMessage", {"chat_id": chat, "text": c.get("shorts") or c["tiktok"]})
                    planned.add(c["archivo"])
                    pubs[c["archivo"]] = {"rank": c["rank"], "hora": t.isoformat(),
                                          "titulo": c["tiktok"].split("\n")[0], "ia": c.get("ia_puntuacion"),
                                          "campana_url": c.get("campana_url", ""),
                                          "n_redes": len(c.get("plataformas", ["tiktok", "youtube"]))}
                tg(token, "sendMessage", {"chat_id": chat, "text":
                   "✅ Cuando lo tengas todo programado, ya está: no te escribo más hasta mañana a las 9:00."})
                state["plan_dia"] = today
                state["planificados"] = sorted(planned)[-200:]
                print(f"📅 Plan del día enviado: {len(plan)} clips.")
            else:
                print("Aún no hay clips nuevos para el plan de hoy.")
        print(f"👀 Vistas actualizadas: {update_views(state, now)}")
    finally:
        state["publicados"] = {k: v for k, v in state.get("publicados", {}).items()
                               if v.get("hora", "9") > (now - timedelta(days=14)).isoformat()}
        st.parent.mkdir(parents=True, exist_ok=True)
        st.write_text(json.dumps(state), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
