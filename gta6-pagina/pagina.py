#!/usr/bin/env python3
"""
Herramientas de la página faceless de GTA 6.

  python pagina.py cola <carpeta con clips.json> [--credito @creador]
      → cola.md + cola.csv: texto adaptado a TikTok, Shorts, Reels y X para
        cada clip, con crédito en su propia línea, listo para aprobar y pegar.

  python pagina.py revision [--dias 1|7]
      → mejor y peor publicación, mediana por pilar, hora y formato, y
        sugerencias. Lo añade a learning.md (no juzga nada con menos de 24 h).
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from statistics import median

HERE = Path(__file__).resolve().parent
PLATFORMS = ("TikTok", "YouTube Shorts", "Instagram Reels", "X")


# ------------------------------------------------------------------ cola

def captions(clip: dict, credit: str) -> dict[str, str]:
    title = clip.get("title", "").strip()
    tags = [t for t in clip.get("hashtags", "").split() if t.startswith("#")]
    credit_line = f"🎥 {credit}" if credit else ""
    few = " ".join(tags[:4])
    ig = " ".join(tags[:5])

    def join(*parts: str) -> str:
        return "\n\n".join(p for p in parts if p)

    return {
        "TikTok": join(title, credit_line, few),
        "YouTube Shorts": join(title, credit_line, few + (" #Shorts" if "#Shorts" not in few else "")),
        "Instagram Reels": join(title, "Sígueme para más GTA 6 cada día 🌴", credit_line, ig),
        "X": join(title.removesuffix(" #Shorts"), credit_line),  # X: sin hashtags
    }


def build_queue(folder: Path, credit: str) -> list[dict]:
    clips = json.loads((folder / "clips.json").read_text(encoding="utf-8"))
    rows = []
    for c in clips:
        caps = captions(c, credit)
        for p in PLATFORMS:
            rows.append({"archivo": Path(c.get("file", "")).name, "publicar": c.get("publish_at", ""),
                         "plataforma": p, "texto": caps[p], "aviso": "; ".join(c.get("notes", []))})
    return rows


def write_queue(rows: list[dict], folder: Path) -> None:
    with open(folder / "cola.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["archivo", "publicar", "plataforma", "texto", "aviso"])
        w.writeheader()
        w.writerows(rows)
    md = ["# Cola de publicación (pendiente de tu «sí»)", ""]
    for r in rows:
        md += [f"## {r['archivo']} → {r['plataforma']} · {r['publicar']}"]
        if r["aviso"]:
            md.append(f"> ⚠️ {r['aviso']}")
        md += ["```", r["texto"], "```", ""]
    (folder / "cola.md").write_text("\n".join(md), encoding="utf-8")


# -------------------------------------------------------------- revisión

def num(v: str) -> float | None:
    try:
        return float(v) if str(v).strip() else None
    except ValueError:
        return None


def best_views(r: dict) -> float | None:
    """Prefiere la lectura de 72 h; si no, 24 h. Nunca 12 h (demasiado pronto)."""
    return num(r.get("views_72h", "")) or num(r.get("views_24h", ""))


def review(rows: list[dict], days: int, today: datetime) -> str:
    since = today - timedelta(days=days)
    scored = []
    for r in rows:
        try:
            when = datetime.fromisoformat(f"{r['date']} {r.get('time') or '00:00'}")
        except (KeyError, ValueError):
            continue
        v = best_views(r)
        if v is None or when < since or today - when < timedelta(hours=24):
            continue  # sin veredicto antes de 24 h
        scored.append((v, r))
    if not scored:
        return f"Sin publicaciones con ≥24 h y métricas en los últimos {days} días."
    scored.sort(key=lambda x: x[0], reverse=True)
    n = 3 if days > 1 else 1
    out = [f"### Revisión {today:%Y-%m-%d} ({'semanal' if days > 1 else 'diaria'}, {len(scored)} publicaciones)"]
    out.append("**Mejores:** " + "; ".join(f"{r['platform']} {r['pillar']} «{r['hook'][:40]}» ({int(v):,})" for v, r in scored[:n]))
    out.append("**Peores:** " + "; ".join(f"{r['platform']} {r['pillar']} «{r['hook'][:40]}» ({int(v):,})" for v, r in scored[-n:]))
    overall = median(v for v, _ in scored)
    for field in ("pillar", "format", "time"):
        groups = defaultdict(list)
        for v, r in scored:
            key = (r.get(field) or "?")[:2] + "h" if field == "time" else (r.get(field) or "?")
            groups[key].append(v)
        meds = sorted(((k, median(vs), len(vs)) for k, vs in groups.items()), key=lambda x: x[1], reverse=True)
        label = {"pillar": "Pilar", "format": "Formato", "time": "Hora"}[field]
        out.append(f"**{label} (mediana):** " + ", ".join(f"{k} {int(m):,} (n={c})" for k, m, c in meds))
        if days > 1:
            doubled = [k for k, m, c in meds if m > overall * 1.3 and c >= 2]
            cut = [k for k, m, c in meds if m < overall * 0.7 and c >= 2]
            if doubled:
                out.append(f"→ Doblar: {', '.join(doubled)}")
            if cut:
                out.append(f"→ Recortar: {', '.join(cut)}")
    tests = {r.get("test_name") for _, r in scored if r.get("test_name")}
    if tests:
        out.append(f"**Experimentos medidos:** {', '.join(sorted(tests))}")
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("cola")
    c.add_argument("carpeta")
    c.add_argument("--credito", default="", help="@creador del clip")
    r = sub.add_parser("revision")
    r.add_argument("--dias", type=int, default=7)
    r.add_argument("--scoreboard", default=str(HERE / "scoreboard.csv"))
    r.add_argument("--learning", default=str(HERE / "learning.md"))
    args = ap.parse_args(argv)

    if args.cmd == "cola":
        folder = Path(args.carpeta)
        rows = build_queue(folder, args.credito)
        write_queue(rows, folder)
        print(f"✔ {len(rows)} textos en {folder / 'cola.md'}")
        return 0

    with open(args.scoreboard, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    text = review(rows, args.dias, datetime.now())
    print(text)
    with open(args.learning, "a", encoding="utf-8") as f:
        f.write("\n" + text + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
