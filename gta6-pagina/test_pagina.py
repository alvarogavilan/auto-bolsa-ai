import csv
import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

import pagina


class PaginaTest(unittest.TestCase):
    def test_queue_has_credit_and_x_without_hashtags(self):
        with tempfile.TemporaryDirectory() as d:
            clips = [{"file": "x/clip_01.mp4", "title": "Esto solo pasa en GTA 6 😳",
                      "hashtags": "#GTA6 #GTAVI #ViceCity #Leonida #gaming #Shorts",
                      "publish_at": "2026-11-19 18:00", "notes": []}]
            Path(d, "clips.json").write_text(json.dumps(clips), encoding="utf-8")
            pagina.main(["cola", d, "--credito", "@streamer"])
            rows = list(csv.DictReader(open(Path(d, "cola.csv"), encoding="utf-8")))
            self.assertEqual(len(rows), 4)
            by = {r["plataforma"]: r["texto"] for r in rows}
            self.assertIn("🎥 @streamer", by["TikTok"])
            self.assertNotIn("#", by["X"])
            self.assertIn("#Shorts", by["YouTube Shorts"])
            self.assertTrue(Path(d, "cola.md").exists())

    def test_review_skips_young_posts_and_ranks(self):
        rows = [
            {"date": "2026-11-15", "time": "13:00", "platform": "TikTok", "pillar": "Clip", "format": "clip",
             "hook": "persecución", "views_24h": "9000", "views_72h": "20000", "test_name": "gancho-pregunta"},
            {"date": "2026-11-15", "time": "21:00", "platform": "X", "pillar": "Oficial", "format": "texto",
             "hook": "noticia", "views_24h": "500", "views_72h": "", "test_name": ""},
            {"date": "2026-11-19", "time": "10:00", "platform": "TikTok", "pillar": "Clip", "format": "clip",
             "hook": "demasiado pronto", "views_12h": "99999", "views_24h": "", "views_72h": ""},
        ]
        text = pagina.review(rows, 7, datetime(2026, 11, 19, 12, 0))
        self.assertIn("persecución", text.split("**Peores")[0])
        self.assertNotIn("demasiado pronto", text)
        self.assertIn("gancho-pregunta", text)


if __name__ == "__main__":
    unittest.main()
