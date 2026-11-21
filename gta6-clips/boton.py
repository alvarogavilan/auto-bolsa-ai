#!/usr/bin/env python3
"""
Lo que ejecuta el botón de GitHub Actions ("Recortar clips GTA 6").

Modo enlace:       python boton.py --url <enlace YouTube/Twitch/Kick/archivo> [--tramo 1:00:00-1:45:00]
Modo seguimiento:  python boton.py --seguimiento campanas.json --horas 26

Deja los clips en ./clips/ y escribe un resumen legible (también en el
resumen del job de GitHub si existe $GITHUB_STEP_SUMMARY).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

import clipper

OUT = Path("clips")
DL = Path("descargas")


def parse_tramo(tramo: str) -> tuple[float, float] | None:
    tramo = (tramo or "").strip()
    if not tramo:
        return None

    def secs(t: str) -> float:
        parts = [float(p) for p in t.strip().split(":")]
        return sum(p * 60 ** i for i, p in enumerate(reversed(parts)))

    a, b = tramo.split("-", 1)
    return secs(a), secs(b)


def download(url: str, tramo: str = "") -> tuple[Path, str]:
    p = Path(url).expanduser()
    if p.exists():
        return p, p.stem
    import yt_dlp  # type: ignore
    from yt_dlp.utils import download_range_func  # type: ignore

    DL.mkdir(exist_ok=True)
    opts = {
        "outtmpl": str(DL / "%(id)s.%(ext)s"),
        "format": "bv*[height<=720]+ba/b[height<=720]/b",  # 720p: directos largos caben y van más rápido
        "merge_output_format": "mp4",
        "quiet": True, "noprogress": True,
    }
    rng = parse_tramo(tramo)
    if rng:
        opts["download_ranges"] = download_range_func(None, [rng])
        opts["force_keyframes_at_cuts"] = False
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
        path = Path(ydl.prepare_filename(info)).with_suffix(".mp4")
        if not path.exists():  # algunos extractores ya dan .mp4 con otro nombre
            cands = sorted(DL.glob(f"{info['id']}*"), key=lambda f: f.stat().st_size)
            path = cands[-1]
        return path, info.get("title") or info["id"]


def video_ts(*infos: dict) -> float:
    """Fecha del vídeo (epoch) con lo que dé la plataforma; 0 si no hay ninguna."""
    from datetime import datetime, timezone
    for d in infos:
        for k in ("timestamp", "release_timestamp"):
            if d.get(k):
                return float(d[k])
        for k in ("upload_date", "release_date"):
            v = str(d.get(k) or "")
            if len(v) == 8 and v.isdigit():  # AAAAMMDD → fin de ese día (UTC)
                return datetime(int(v[:4]), int(v[4:6]), int(v[6:]), 23, 59, 59, tzinfo=timezone.utc).timestamp()
    return 0.0


def recent_videos(fuente: str, filtro: str, horas: float, max_videos: int, desde: float = 0.0,
                  excluir: tuple = ()) -> list[dict]:
    import yt_dlp  # type: ignore

    with yt_dlp.YoutubeDL({"quiet": True, "extract_flat": "in_playlist",
                           "playlistend": 15, "ignoreerrors": True}) as ydl:
        info = ydl.extract_info(fuente, download=False) or {}
    entries = [e for e in (info.get("entries") or [info]) if e][: max_videos * 3]
    out, limit = [], time.time() - horas * 3600
    with yt_dlp.YoutubeDL({"quiet": True, "ignoreerrors": True}) as ydl:
        for e in entries:
            url = e.get("webpage_url") or e.get("url")
            full = ydl.extract_info(url, download=False) or {}
            title = full.get("title") or e.get("title") or ""
            ts = video_ts(full, e)
            # sin fecha: se acepta (el registro de procesados evita repetirlo)
            fresh = ts == 0 or (ts >= limit and ts >= desde)
            ok = (fresh and filtro.lower() in title.lower() and not full.get("is_live")
                  and not any(x.lower() in title.lower() for x in excluir))
            print(f"[seguimiento] {url} fecha={int(ts)} vivo={bool(full.get('is_live'))} "
                  f"aceptado={ok} titulo={title[:60]!r}", file=sys.stderr)
            if ok:
                out.append({"url": url, "title": title or url.rsplit('/', 1)[-1],
                            "dur": float(full.get("duration") or e.get("duration") or 0)})
            if len(out) >= max_videos:
                break
    return out


def hms(t: float) -> str:
    t = int(t)
    return f"{t // 3600}:{t // 60 % 60:02d}:{t % 60:02d}"


def probe_duration_url(url: str) -> float:
    p = Path(url).expanduser()
    if p.exists():
        return clipper.probe_duration(p)
    try:
        import yt_dlp  # type: ignore
        with yt_dlp.YoutubeDL({"quiet": True, "ignoreerrors": True}) as ydl:
            return float((ydl.extract_info(url, download=False) or {}).get("duration") or 0)
    except Exception:
        return 0.0


def expand_jobs(jobs: list[dict], chunk_min: float = 90, limit: int = 20) -> list[dict]:
    """Trocea directos largos en tramos (cada uno a su servidor): no se llena el disco y va en paralelo."""
    out: list[dict] = []
    for j in jobs:
        dur = float(j.get("dur") or 0) or (0 if j.get("tramo") else probe_duration_url(j["url"]))
        chunk = chunk_min * 60
        if j.get("tramo") or dur <= chunk * 1.2:
            out.append({k: v for k, v in j.items() if k != "dur"})
            continue
        n = int(-(-dur // chunk))
        per = str(max(3, -(-int(j.get("clips") or 6) // n)))
        for i in range(n):
            a, b = i * chunk, min(dur, (i + 1) * chunk)
            out.append({**{k: v for k, v in j.items() if k != "dur"}, "tramo": f"{hms(a)}-{hms(b)}",
                        "clips": per, "titulo": f"{str(j.get('titulo', ''))[:50]} [{hms(a)}]"})
    return out[:limit]


def list_jobs(cfg_path: Path, horas: float, procesados: set[str] | None = None) -> list[dict]:
    """Vídeos nuevos de todas las campañas con permiso, cada uno con sus ajustes."""
    if not cfg_path.exists():
        return []
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    from datetime import datetime, timezone
    jobs, seen = [], set(procesados or ())
    for camp in cfg.get("campanas", []):
        if not camp.get("permiso"):
            print(f"'{camp.get('nombre')}' omitida: falta 'permiso'", file=sys.stderr)
            continue
        if camp.get("pausada"):
            print(f"'{camp.get('nombre')}' en pausa: {camp.get('motivo_pausa', '')}", file=sys.stderr)
            continue
        for fuente in camp.get("fuentes", []):
            try:
                desde = datetime.fromisoformat(camp["desde"]).replace(tzinfo=timezone.utc).timestamp() if camp.get("desde") else 0.0
                vids = recent_videos(fuente, camp.get("filtro", "GTA"), horas, camp.get("max_videos", 2), desde,
                                     tuple(camp.get("excluir", [])))
            except Exception as e:
                print(f"No pude leer {fuente}: {e}", file=sys.stderr)
                continue
            for v in vids:
                if v["url"] in seen:
                    continue
                seen.add(v["url"])
                jobs.append({
                    "url": v["url"], "titulo": v["title"][:80],
                    "handle": camp.get("mencion") or cfg.get("handle", ""),
                    "clips": str(camp.get("clips_por_video", 6)),
                    "duracion": str(camp.get("duracion", 30)),
                    "tramo": camp.get("tramo", ""),
                    "tags": " ".join(camp.get("hashtags_obligatorios", [])),
                    "dur": v.get("dur", 0),
                })
    return jobs


def clip(src: Path, title: str, args, handle: str, extra_tags: list[str]) -> list[dict]:
    name = re.sub(r"[^\w-]+", "_", title)[:50].strip("_") or src.stem
    out = OUT / name
    argv = [str(src), "-n", str(args.n), "--length", str(args.duracion),
            "--out", str(OUT), "--handle", handle, "--min-score", str(args.min_score)]
    if args.contexto:
        argv += ["--context", args.contexto]
    if args.tendencias:
        argv += ["--tendencias", args.tendencias]
    if args.subs:
        argv.append("--subs")
    clipper.main(argv)
    produced = OUT / src.stem
    if produced != out and produced.exists():
        if out.exists():
            import shutil
            shutil.rmtree(out)
        produced.rename(out)
    clips = json.loads((out / "clips.json").read_text(encoding="utf-8"))
    for c in clips:
        c["file"] = str(out / Path(c["file"]).name)
        if extra_tags:
            c["hashtags"] += " " + " ".join(extra_tags)
        credito = f"🎥 Clip de {handle}\n" if handle else ""
        c["description"] = (f"{c['title']}\n\n{credito}Grand Theft Auto VI © Rockstar Games.\n\n"
                            f"{c['hashtags']}")
    # reescribe json, csv y prompt con rutas, hashtags y descripción definitivos
    clipper.write_reports([clipper.Clip(**c) for c in clips], out)
    # texto listo para copiar y pegar al subir desde el móvil
    lines = []
    for c in clips:
        lines.append(f"=== {Path(c['file']).name}  (publicar: {c['publish_at']}) ===\n"
                     f"TÍTULO:\n{c['title']}\n\nDESCRIPCIÓN:\n{c['description']}\n")
    (out / "COPIAR_Y_PEGAR.txt").write_text("\n".join(lines), encoding="utf-8")
    if args.borrar_original and DL in src.parents:
        src.unlink(missing_ok=True)
    return clips


def summary(rows: list[tuple[str, list[dict]]], errors: list[str]) -> None:
    md = ["# 🎬 Clips GTA 6 listos", ""]
    total = sum(len(c) for _, c in rows)
    if total:
        md += [f"**{total} clips.** Descárgalos abajo, en *Artifacts → clips-gta6*. "
               "Dentro de cada carpeta, `COPIAR_Y_PEGAR.txt` trae el título y la descripción.", ""]
    for title, clips in rows:
        md += [f"## {title}", "", "| Clip | Momento | Publicar | Título |", "|---|---|---|---|"]
        for c in clips:
            md.append(f"| {Path(c['file']).name} | {c['start']:.0f}s–{c['end']:.0f}s | "
                      f"{c['publish_at']} | {c['title']} |")
        md.append("")
    if not rows and not errors:
        md.append("No había vídeos nuevos de GTA 6 en tus fuentes.")
    for e in errors:
        md.append(f"> ⚠️ {e}")
    text = "\n".join(md)
    print(text)
    OUT.mkdir(exist_ok=True)
    (OUT / "RESUMEN.md").write_text(text, encoding="utf-8")
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as f:
            f.write(text + "\n")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="")
    ap.add_argument("--tramo", default="", help="p.ej. 1:00:00-1:40:00 para directos largos")
    ap.add_argument("--seguimiento", default="", help="campanas.json para el modo diario")
    ap.add_argument("--horas", type=float, default=26)
    ap.add_argument("-n", type=int, default=6)
    ap.add_argument("--duracion", type=float, default=30)
    ap.add_argument("--handle", default="")
    ap.add_argument("--contexto", default="")
    ap.add_argument("--subs", action="store_true", help="subtítulos automáticos grandes (faster-whisper)")
    ap.add_argument("--min-score", type=float, default=1.0)
    ap.add_argument("--tendencias", default="", help="tendencias.json del radar viral")
    ap.add_argument("--tags", default="", help="hashtags extra obligatorios de la campaña")
    ap.add_argument("--borrar-original", action="store_true")
    ap.add_argument("--expandir", default="", help="JSON de trabajos a trocear en tramos")
    ap.add_argument("--procesados", default="", help="registro de vídeos ya recortados (evita repetir)")
    ap.add_argument("--listar-json", action="store_true",
                    help="con --seguimiento: solo imprime los vídeos nuevos (para repartirlos en paralelo)")
    args = ap.parse_args(argv)

    rows, errors = [], []
    if args.url:
        try:
            src, title = download(args.url.strip(), args.tramo)
            rows.append((title, clip(src, title, args, args.handle, args.tags.split())))
        except Exception as e:
            errors.append(f"No pude procesar {args.url}: {e}")
    elif args.expandir:
        print(json.dumps(expand_jobs(json.loads(args.expandir)), ensure_ascii=False))
        return 0
    elif args.seguimiento and args.listar_json:
        reg = Path(args.procesados) if args.procesados else None
        done = set(reg.read_text(encoding="utf-8").split()) if reg and reg.exists() else set()
        jobs = expand_jobs(list_jobs(Path(args.seguimiento), args.horas, done))
        if reg:
            reg.parent.mkdir(parents=True, exist_ok=True)
            reg.write_text("\n".join(sorted(done | {j["url"] for j in jobs})), encoding="utf-8")
        print(json.dumps(jobs, ensure_ascii=False))
        return 0
    elif args.seguimiento:
        cfg = json.loads(Path(args.seguimiento).read_text(encoding="utf-8"))
        for camp in cfg.get("campanas", []):
            if not camp.get("permiso"):
                errors.append(f"'{camp.get('nombre')}' omitida: falta el enlace de 'permiso'.")
                continue
            for fuente in camp.get("fuentes", []):
                try:
                    vids = recent_videos(fuente, camp.get("filtro", "GTA"), args.horas,
                                         camp.get("max_videos", 1))
                except Exception as e:
                    errors.append(f"No pude leer {fuente}: {e}")
                    continue
                for v in vids:
                    try:
                        src, title = download(v["url"], camp.get("tramo", ""))
                        args.n = camp.get("clips_por_video", args.n)
                        args.duracion = camp.get("duracion", args.duracion)
                        handle = camp.get("mencion") or cfg.get("handle", "")
                        rows.append((f"{camp.get('nombre')}: {title}",
                                     clip(src, title, args, handle, camp.get("hashtags_obligatorios", []))))
                    except Exception as e:
                        errors.append(f"Falló {v['url']}: {e}")
    else:
        ap.error("usa --url o --seguimiento")
    summary(rows, errors)
    return 0 if rows or not errors else 1


if __name__ == "__main__":
    sys.exit(main())
