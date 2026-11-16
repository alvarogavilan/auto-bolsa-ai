#!/usr/bin/env python3
"""
Piloto automático para campañas de clipping de GTA 6 (sin grabar tú nada).

Las campañas de clipping (p. ej. Whop Content Rewards) pagan por cada 1.000
vistas a quien recorte los directos de un streamer o marca y los publique en
sus redes. Este script lo hace solo, cada vez que se ejecuta:

  1. Mira las fuentes de cada campaña (canal de YouTube, Twitch, carpeta…)
     y descarga los vídeos nuevos de GTA 6 (yt-dlp).
  2. Saca los mejores momentos en vertical 9:16 con clipper.py.
  3. Los sube a TU canal de YouTube como Shorts PROGRAMADOS (API oficial),
     repartidos en N publicaciones al día.
  4. Apunta los enlaces en enlaces_para_enviar.csv para enviarlos a la campaña.

Solo procesa campañas con el campo "permiso" relleno (el enlace a la campaña
o al acuerdo con el creador). Recortar a alguien sin permiso = strikes.

Uso:
  python auto_campanas.py --auth          # una sola vez: conecta tu YouTube
  python auto_campanas.py                 # una pasada (ponlo en cron cada 3 h)
  python auto_campanas.py --dry-run       # todo menos subir
"""
from __future__ import annotations

import argparse
import csv
import json
import shutil
import sys
from datetime import datetime, timedelta
from pathlib import Path

import clipper

HERE = Path(__file__).resolve().parent
YT_SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]


# ------------------------------------------------------------------ estado

def load_json(path: Path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def save_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


# ------------------------------------------------------------ descubrimiento

def discover(fuente: str, filtro: str, max_videos: int) -> list[dict]:
    """Devuelve [{id, url, title}] más recientes de una fuente."""
    p = Path(fuente).expanduser()
    if p.exists():  # carpeta o archivo local (p. ej. Drive sincronizado)
        files = [p] if p.is_file() else sorted(
            (f for f in p.iterdir() if f.suffix.lower() in clipper.VIDEO_EXTS),
            key=lambda f: f.stat().st_mtime, reverse=True)
        return [{"id": f"local:{f.resolve()}", "url": str(f), "title": f.stem}
                for f in files if filtro.lower() in f.stem.lower()][:max_videos]

    import yt_dlp  # type: ignore
    opts = {"quiet": True, "extract_flat": "in_playlist", "playlistend": max(10, max_videos * 5),
            "ignoreerrors": True}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(fuente, download=False) or {}
    entries = info.get("entries") or [info]
    out = []
    for e in entries:
        if not e:
            continue
        title = e.get("title") or ""
        if filtro and filtro.lower() not in title.lower():
            continue
        url = e.get("webpage_url") or e.get("url")
        out.append({"id": f"{e.get('ie_key') or e.get('extractor_key', '')}:{e.get('id')}",
                    "url": url, "title": title})
        if len(out) >= max_videos:
            break
    return out


def download(video: dict, dest: Path) -> Path:
    if video["id"].startswith("local:"):
        return Path(video["url"])
    import yt_dlp  # type: ignore
    dest.mkdir(parents=True, exist_ok=True)
    opts = {"quiet": True, "outtmpl": str(dest / "%(id)s.%(ext)s"),
            "format": "bv*[height<=1080]+ba/b[height<=1080]/b",
            "merge_output_format": "mp4"}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(video["url"], download=True)
        return Path(ydl.prepare_filename(info)).with_suffix(".mp4")


# ------------------------------------------------------------------ YouTube

def youtube_client(cfg: dict, interactive: bool = False):
    from google.auth.transport.requests import Request  # type: ignore
    from google.oauth2.credentials import Credentials  # type: ignore
    from googleapiclient.discovery import build  # type: ignore

    token = HERE / cfg.get("token", "token.json")
    creds = Credentials.from_authorized_user_file(str(token), YT_SCOPES) if token.exists() else None
    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
    if not creds or not creds.valid:
        if not interactive:
            raise SystemExit("✖ YouTube no conectado. Ejecuta una vez: python auto_campanas.py --auth")
        from google_auth_oauthlib.flow import InstalledAppFlow  # type: ignore
        secrets = HERE / cfg.get("client_secrets", "client_secret.json")
        flow = InstalledAppFlow.from_client_secrets_file(str(secrets), YT_SCOPES)
        creds = flow.run_local_server(port=0)
    token.write_text(creds.to_json())
    return build("youtube", "v3", credentials=creds)


def upload(yt, item: dict) -> str:
    from googleapiclient.http import MediaFileUpload  # type: ignore
    publish_utc = datetime.fromisoformat(item["publish_at"]).astimezone().astimezone(
        tz=__import__("datetime").timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    body = {
        "snippet": {"title": item["title"][:100], "description": item["description"][:4900],
                    "tags": [t.lstrip("#") for t in item["hashtags"].split()], "categoryId": "20"},
        "status": {"privacyStatus": "private", "publishAt": publish_utc,
                   "selfDeclaredMadeForKids": False},
    }
    req = yt.videos().insert(part="snippet,status", body=body,
                             media_body=MediaFileUpload(item["file"], chunksize=-1, resumable=True))
    resp = None
    while resp is None:
        _, resp = req.next_chunk()
    return f"https://youtube.com/shorts/{resp['id']}"


# ---------------------------------------------------------------- calendario

def next_slots(taken: list[str], count: int, per_day: int, slots: list[str]) -> list[str]:
    taken_set = set(taken)
    now = datetime.now() + timedelta(minutes=30)
    day, out = now.date(), []
    while len(out) < count:
        for s in slots[:per_day]:
            h, m = map(int, s.split(":"))
            when = datetime(day.year, day.month, day.day, h, m)
            key = when.strftime("%Y-%m-%d %H:%M")
            if when > now and key not in taken_set:
                out.append(key)
                taken_set.add(key)
                if len(out) == count:
                    break
        day += timedelta(days=1)
    return out


# ------------------------------------------------------------------ pasada

def run_once(cfg: dict, dry_run: bool) -> None:
    state_path = HERE / "estado.json"
    state = load_json(state_path, {"procesados": [], "cola": [], "subidos": []})
    yt_cfg = cfg.get("youtube", {})
    handle = cfg.get("handle", "")

    for camp in cfg.get("campanas", []):
        nombre = camp.get("nombre", "campaña")
        if not camp.get("permiso"):
            print(f"⛔ '{nombre}': sin campo 'permiso' → se omite (no se recorta a nadie sin permiso)")
            continue
        for fuente in camp.get("fuentes", []):
            try:
                videos = discover(fuente, camp.get("filtro", "GTA"), camp.get("max_videos", 2))
            except Exception as e:  # red caída, canal privado…
                print(f"⚠ '{nombre}': no pude leer {fuente}: {e}")
                continue
            for v in videos:
                if v["id"] in state["procesados"]:
                    continue
                print(f"⬇ [{nombre}] {v['title']}")
                try:
                    src = download(v, HERE / "descargas")
                    out = HERE / "salida" / slug(nombre)
                    argv = [str(src), "-n", str(camp.get("clips_por_video", 6)),
                            "--length", str(camp.get("duracion", 30)), "--out", str(out),
                            "--handle", camp.get("mencion") or handle]
                    if camp.get("subtitulos"):
                        argv.append("--subs")
                    if camp.get("contexto"):
                        argv += ["--context", camp["contexto"]]
                    clipper.main(argv)
                except Exception as e:
                    print(f"✖ fallo con {v['url']}: {e}")
                    continue
                clips = load_json(out / src.stem / "clips.json", [])
                extra = " ".join(camp.get("hashtags_obligatorios", []))
                credit = f"Clip de {camp['mencion']} " if camp.get("mencion") else ""
                for c in clips:
                    tags = f"{c['hashtags']} {extra}".strip()
                    state["cola"].append({
                        "campana": nombre, "file": c["file"],
                        "title": f"{c['title']} #Shorts",
                        "description": f"{credit}| Original: {v['url']}\n\n{c['description']}\n{extra}",
                        "hashtags": tags, "publish_at": "",
                    })
                state["procesados"].append(v["id"])
                if cfg.get("borrar_descargas", True) and not v["id"].startswith("local:"):
                    src.unlink(missing_ok=True)
                save_json(state_path, state)

    # programar y subir (cuota API YouTube: ~6 subidas/día por proyecto)
    pending = [q for q in state["cola"] if not q.get("url")]
    budget = yt_cfg.get("max_subidas_por_pasada", 6)
    pending = pending[:budget]
    if not pending:
        print("✔ Nada nuevo que subir.")
        return
    taken = [q["publish_at"] for q in state["cola"] if q.get("publish_at")]
    for q in pending:
        if not q["publish_at"]:
            q["publish_at"] = next_slots(taken, 1, yt_cfg.get("por_dia", 3),
                                         yt_cfg.get("horas", ["13:00", "18:00", "21:30"]))[0]
            taken.append(q["publish_at"])
    save_json(state_path, state)

    if dry_run:
        for q in pending:
            print(f"  (simulado) {q['publish_at']}  {q['title']}  ← {Path(q['file']).name}")
        return

    yt = youtube_client(yt_cfg)
    links = HERE / "enlaces_para_enviar.csv"
    new_file = not links.exists()
    with open(links, "a", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        if new_file:
            w.writerow(["campaña", "publicación", "enlace", "título"])
        for q in pending:
            try:
                q["url"] = upload(yt, q)
            except Exception as e:
                print(f"✖ subida fallida ({e}); se reintentará en la próxima pasada")
                break
            print(f"⬆ {q['publish_at']}  {q['url']}")
            w.writerow([q["campana"], q["publish_at"], q["url"], q["title"]])
            save_json(state_path, state)


def slug(s: str) -> str:
    return "".join(ch if ch.isalnum() else "_" for ch in s).strip("_")[:40] or "campana"


def main() -> int:
    ap = argparse.ArgumentParser(description="Piloto automático de campañas de clipping GTA 6")
    ap.add_argument("--config", default=str(HERE / "campanas.json"))
    ap.add_argument("--auth", action="store_true", help="conectar YouTube (una vez)")
    ap.add_argument("--dry-run", action="store_true", help="no sube nada")
    args = ap.parse_args()

    cfg_path = Path(args.config)
    if not cfg_path.exists():
        shutil.copy(HERE / "campanas.ejemplo.json", cfg_path)
        print(f"Creado {cfg_path.name}: rellénalo con tus campañas y vuelve a ejecutar.")
        return 1
    cfg = load_json(cfg_path, {})
    if args.auth:
        youtube_client(cfg.get("youtube", {}), interactive=True)
        print("✔ YouTube conectado.")
        return 0
    run_once(cfg, args.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
