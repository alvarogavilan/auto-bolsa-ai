#!/usr/bin/env python3
"""
Radar de viralidad GTA 6 — el "equipo de análisis" automático.

Cada ejecución:
  1. YouTube Shorts (API oficial): busca los Shorts de GTA 6 de las últimas
     24 h y mide su VELOCIDAD (vistas por hora), no solo las vistas totales.
  2. Extrae lo que funciona: palabras y hashtags de los títulos ganadores,
     duración ideal y mejores horas para publicar.
  3. Twitch (API oficial): qué directos de GTA 6 tienen más público ahora
     (descubrir streamers con campaña) y qué VODs NUEVOS de tus campañas
     hay que recortar ya → objetivos para el botón de clips.
  4. Escribe tendencias.json (lo usa el clipper para títulos y hashtags),
     objetivos.json y un informe legible RADAR.md.

Claves (secretos de GitHub, gratis):
  YT_API_KEY                         → YouTube Data API v3
  TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET → dev.twitch.tv
Sin claves, esa parte se omite y el resto sigue funcionando.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from statistics import median

YT = "https://www.googleapis.com/youtube/v3"
QUERIES = [("GTA 6", "ES", "es"), ("GTA 6", "US", "en"), ("GTA VI", "US", "en")]
STOP = set("""
gta vi 6 the a an and or of to in on for with is it this that i my me you your we our
el la los las un una y o de del en con por para que es lo mi tu se al su sus no si ya
shorts short grand theft auto video videos new nuevo nueva vs from at be are was how
""".split())
MADRID = timezone(timedelta(hours=1))  # hora peninsular de invierno


# ---------------------------------------------------------------- http

def get_json(url: str, headers: dict | None = None, data: bytes | None = None) -> dict:
    req = urllib.request.Request(url, headers=headers or {}, data=data)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_dt(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def iso_duration_s(d: str) -> int:
    m = re.fullmatch(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", d or "")
    if not m:
        return 0
    days, h, mi, s = (int(x or 0) for x in m.groups())
    return days * 86400 + h * 3600 + mi * 60 + s


def twitch_duration_s(d: str) -> int:
    return sum(int(n) * {"h": 3600, "m": 60, "s": 1}[u] for n, u in re.findall(r"(\d+)([hms])", d or ""))


# ---------------------------------------------------------------- YouTube

def youtube_shorts(key: str, hours: float, now: datetime) -> list[dict]:
    after = iso(now - timedelta(hours=hours))
    ids: list[str] = []
    for q, region, lang in QUERIES:
        params = {"part": "id", "q": q, "type": "video", "videoDuration": "short",
                  "order": "viewCount", "publishedAfter": after, "maxResults": 50,
                  "regionCode": region, "relevanceLanguage": lang, "key": key}
        data = get_json(f"{YT}/search?{urllib.parse.urlencode(params)}")
        ids += [i["id"]["videoId"] for i in data.get("items", []) if i.get("id", {}).get("videoId")]
    ids = list(dict.fromkeys(ids))
    videos = []
    for i in range(0, len(ids), 50):
        params = {"part": "snippet,statistics,contentDetails", "id": ",".join(ids[i:i + 50]), "key": key}
        videos += get_json(f"{YT}/videos?{urllib.parse.urlencode(params)}").get("items", [])
    out = []
    for v in videos:
        sn, st = v["snippet"], v.get("statistics", {})
        dur = iso_duration_s(v.get("contentDetails", {}).get("duration", ""))
        if dur == 0 or dur > 180:  # Shorts: hasta 3 min
            continue
        published = parse_dt(sn["publishedAt"])
        age_h = max((now - published).total_seconds() / 3600, 0.25)
        views = int(st.get("viewCount", 0))
        likes, comments = int(st.get("likeCount", 0)), int(st.get("commentCount", 0))
        out.append({
            "id": v["id"], "url": f"https://youtube.com/shorts/{v['id']}",
            "title": sn["title"], "channel": sn["channelTitle"],
            "description": sn.get("description", "")[:500], "tags": sn.get("tags", []),
            "published": sn["publishedAt"], "age_h": round(age_h, 1), "duration_s": dur,
            "views": views, "views_per_hour": round(views / age_h),
            "engagement": round((likes + comments) / views, 4) if views else 0.0,
        })
    out.sort(key=lambda x: x["views_per_hour"], reverse=True)
    return out


def analyze(shorts: list[dict]) -> dict:
    """Qué tienen en común los Shorts que más rápido crecen."""
    if not shorts:
        return {}
    top = shorts[: max(10, len(shorts) // 3)]
    w_words, w_tags, w_bigrams = Counter(), Counter(), Counter()
    for s in top:
        weight = math.log10(s["views_per_hour"] + 10)
        words = [w for w in re.findall(r"[a-záéíóúñü0-9']+", s["title"].lower()) if w not in STOP and len(w) > 2]
        for w in set(words):
            w_words[w] += weight
        for a, b in set(zip(words, words[1:])):
            w_bigrams[f"{a} {b}"] += weight
        tags = set(t.lower() for t in re.findall(r"#\w+", s["title"] + " " + s["description"]))
        for t in tags:
            if t.strip("#") not in {"shorts", "gta6", "gtavi", "gta"}:
                w_tags[t] += weight
    hours = defaultdict(list)
    for s in shorts:
        hours[parse_dt(s["published"]).astimezone(MADRID).hour].append(s["views_per_hour"])
    best_hours = sorted(((h, median(v)) for h, v in hours.items() if len(v) >= 2),
                        key=lambda x: x[1], reverse=True)[:4]
    durs = sorted(s["duration_s"] for s in top)
    channels = Counter(s["channel"] for s in top).most_common(8)
    return {
        "muestra": len(shorts),
        "palabras": [w for w, _ in w_words.most_common(15)],
        "frases": [b for b, c in w_bigrams.most_common(10) if c > 1.5],
        "hashtags": [t for t, _ in w_tags.most_common(10)],
        "duracion_ideal_s": durs[len(durs) // 2] if durs else 30,
        "mejores_horas": [f"{h:02d}:00" for h, _ in best_hours],
        "canales_top": [c for c, _ in channels],
        "velocidad_mediana_top": int(median(s["views_per_hour"] for s in top)),
    }


# ---------------------------------------------------------------- Twitch

def twitch_session(cid: str, secret: str) -> dict:
    data = urllib.parse.urlencode({"client_id": cid, "client_secret": secret,
                                   "grant_type": "client_credentials"}).encode()
    token = get_json("https://id.twitch.tv/oauth2/token", data=data)["access_token"]
    return {"Client-Id": cid, "Authorization": f"Bearer {token}"}


def twitch_get(h: dict, path: str, **params) -> list[dict]:
    q = urllib.parse.urlencode(params, doseq=True)
    return get_json(f"https://api.twitch.tv/helix/{path}?{q}", headers=h).get("data", [])


def twitch_live_gta(h: dict) -> list[dict]:
    games = twitch_get(h, "games", name=["Grand Theft Auto VI", "Grand Theft Auto 6"])
    if not games:
        return []
    streams = twitch_get(h, "streams", game_id=games[0]["id"], first=25)
    return [{"streamer": s["user_login"], "titulo": s["title"], "espectadores": s["viewer_count"],
             "idioma": s["language"], "url": f"https://www.twitch.tv/{s['user_login']}"} for s in streams]


def twitch_logins(cfg: dict) -> dict[str, dict]:
    """streamer → campaña (solo campañas con permiso)."""
    out = {}
    for camp in cfg.get("campanas", []):
        if not camp.get("permiso"):
            continue
        for f in camp.get("fuentes", []):
            m = re.search(r"twitch\.tv/([A-Za-z0-9_]+)", f)
            if m:
                out[m.group(1).lower()] = camp
    return out


def twitch_targets(h: dict, logins: dict[str, dict], hours: float, now: datetime) -> list[dict]:
    if not logins:
        return []
    users = twitch_get(h, "users", login=list(logins))
    live = {s["user_id"] for s in twitch_get(h, "streams", user_id=[u["id"] for u in users])} if users else set()
    jobs = []
    for u in users:
        camp = logins[u["login"].lower()]
        for v in twitch_get(h, "videos", user_id=u["id"], type="archive", first=5):
            start = parse_dt(v["created_at"])
            end = start + timedelta(seconds=twitch_duration_s(v["duration"]))
            still_live = u["id"] in live and end > now - timedelta(minutes=15)
            if still_live or end < now - timedelta(hours=hours):
                continue  # aún en directo (se recorta al acabar) o ya procesado antes
            if camp.get("filtro", "GTA").lower() not in v["title"].lower():
                continue
            jobs.append({
                "url": v["url"], "titulo": f"{u['login']}: {v['title'][:60]}",
                "handle": camp.get("mencion") or f"@{u['login']}",
                "clips": str(camp.get("clips_por_video", 8)),
                "duracion": str(camp.get("duracion", 30)), "tramo": camp.get("tramo", ""),
                "tags": " ".join(camp.get("hashtags_obligatorios", [])),
                "prioridad": int(v.get("view_count", 0)),
            })
    jobs.sort(key=lambda j: j["prioridad"], reverse=True)
    return jobs[:20]


# ---------------------------------------------------------------- informe

def report(trend: dict, shorts: list[dict], live: list[dict], jobs: list[dict], notes: list[str]) -> str:
    md = ["# 📡 Radar viral GTA 6", f"_Actualizado {datetime.now(MADRID):%d/%m %H:%M} (hora de España)_", ""]
    if trend:
        md += ["## Qué está funcionando ahora en Shorts",
               f"- **Palabras ganadoras:** {', '.join(trend['palabras'][:10])}",
               f"- **Frases:** {', '.join(trend['frases'][:6]) or '—'}",
               f"- **Hashtags extra:** {' '.join(trend['hashtags'][:8]) or '—'}",
               f"- **Duración ideal:** ~{trend['duracion_ideal_s']} s",
               f"- **Mejores horas para publicar:** {', '.join(trend['mejores_horas']) or 'pocos datos aún'}",
               f"- **Velocidad de los mejores:** {trend['velocidad_mediana_top']:,} vistas/hora", "",
               "### Top 10 Shorts por velocidad (últimas 24 h)", "| Vistas/h | Vistas | Título | Canal |", "|---|---|---|---|"]
        for s in shorts[:10]:
            md.append(f"| {s['views_per_hour']:,} | {s['views']:,} | [{s['title'][:60]}]({s['url']}) | {s['channel']} |")
        md.append("")
    if live:
        md += ["## Directos de GTA 6 con más público ahora (Twitch)",
               "Busca si alguno tiene campaña de clipping: son los que más vistas darán.", "",
               "| Espectadores | Streamer | Idioma |", "|---|---|---|"]
        md += [f"| {s['espectadores']:,} | [{s['streamer']}]({s['url']}) | {s['idioma']} |" for s in live[:15]]
        md.append("")
    md += ["## Objetivos para recortar ahora"]
    md += [f"- [{j['titulo']}]({j['url']})" for j in jobs] or ["- Ningún VOD nuevo de tus campañas en esta ventana."]
    md += [""] + [f"> ⚠️ {n}" for n in notes]
    return "\n".join(md)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--campanas", default="campanas.seguimiento.json")
    ap.add_argument("--horas-shorts", type=float, default=24)
    ap.add_argument("--horas-vods", type=float, default=2.2)
    ap.add_argument("--salida", default="radar")
    args = ap.parse_args(argv)

    now = datetime.now(timezone.utc)
    out = Path(args.salida)
    out.mkdir(parents=True, exist_ok=True)
    notes: list[str] = []
    shorts, trend, live, jobs = [], {}, [], []

    yt_key = os.environ.get("YT_API_KEY", "")
    if yt_key:
        try:
            shorts = youtube_shorts(yt_key, args.horas_shorts, now)
            trend = analyze(shorts)
        except Exception as e:
            notes.append(f"YouTube: {e}")
    else:
        notes.append("Falta el secreto YT_API_KEY: sin análisis de Shorts.")

    cfg_path = Path(args.campanas)
    cfg = json.loads(cfg_path.read_text(encoding="utf-8")) if cfg_path.exists() else {}
    cid, secret = os.environ.get("TWITCH_CLIENT_ID", ""), os.environ.get("TWITCH_CLIENT_SECRET", "")
    if cid and secret:
        try:
            h = twitch_session(cid, secret)
            live = twitch_live_gta(h)
            jobs = twitch_targets(h, twitch_logins(cfg), args.horas_vods, now)
        except Exception as e:
            notes.append(f"Twitch: {e}")
    else:
        notes.append("Faltan TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET: sin directos ni objetivos de Twitch.")
    if not cfg:
        notes.append("Falta campanas.seguimiento.json: añade tus campañas para tener objetivos.")

    (out / "tendencias.json").write_text(json.dumps(trend, ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "shorts_top.json").write_text(json.dumps(shorts[:50], ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "objetivos.json").write_text(json.dumps(jobs, ensure_ascii=False), encoding="utf-8")
    text = report(trend, shorts, live, jobs, notes)
    (out / "RADAR.md").write_text(text, encoding="utf-8")
    print(text)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as f:
            f.write(text + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
