"""Prueba de extremo a extremo: genera un "gameplay" sintético con 3 explosiones
de audio conocidas y comprueba que el clipper las encuentra y renderiza 9:16.

    python -m unittest test_clipper.py
"""
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

import clipper

PEAKS = (40, 100, 150)


class ClipperTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp())
        cls.video = cls.tmp / "partida.mp4"
        gate = "+".join(f"between(t,{p},{p + 2})" for p in PEAKS)
        subprocess.run([
            "ffmpeg", "-v", "error", "-y",
            "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=180",
            "-f", "lavfi", "-i", "anoisesrc=d=180:a=0.02:r=48000",
            "-f", "lavfi", "-i", "sine=f=300:d=180:r=48000",
            "-filter_complex", f"[2:a]volume='if({gate},0.9,0)':eval=frame[s];[1:a][s]amix=inputs=2:normalize=0[a]",
            "-map", "0:v", "-map", "[a]", "-c:v", "libx264", "-preset", "ultrafast",
            "-c:a", "aac", "-shortest", str(cls.video),
        ], check=True)

    def test_detects_peaks_and_renders_vertical(self):
        out = self.tmp / "salida"
        rc = clipper.main([str(self.video), "-n", "3", "--length", "12",
                           "--handle", "@test", "--out", str(out), "--preset", "ultrafast"])
        self.assertEqual(rc, 0)
        clips = json.loads((out / "partida" / "clips.json").read_text())
        self.assertEqual(len(clips), 3)
        for c, expected in zip(clips, PEAKS):
            self.assertAlmostEqual(c["peak"], expected, delta=2)
            self.assertLessEqual(c["peak"] - c["start"], 3.5, "el gancho debe entrar en los 3 primeros segundos")
            self.assertTrue(c["publish_at"])
            dims = subprocess.run(
                ["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries",
                 "stream=width,height", "-of", "csv=p=0", c["file"]],
                capture_output=True, text=True, check=True).stdout.strip()
            self.assertEqual(dims, "1080,1920")

    def test_no_overlap(self):
        import numpy as np
        score = np.zeros(400)
        score[100] = 5
        score[102] = 4.9  # pegado al primero: debe descartarse
        score[300] = 3
        clips = clipper.pick_clips(score, 200, 3, 20, 9, 5, "x")
        self.assertEqual([c.peak for c in clips], [50.0, 150.0])

    def test_flat_video_still_gives_best_clip(self):
        import numpy as np
        clips = clipper.pick_clips(np.zeros(40), 20, 2, 8, 9, 2, "x")
        self.assertGreaterEqual(len(clips), 1)
        self.assertIn("momento flojo", clips[0].notes[-1])

    def test_censor_removes_slurs_and_masks_profanity(self):
        out = clipper.censor("ONE JOB MY NIGGA FUCKING RETARD what a classic")
        self.assertNotIn("NIGGA", out.upper())
        self.assertNotIn("RETARD", out.upper())
        self.assertIn("F*CKING", out)
        self.assertIn("classic", out)
        self.assertTrue(clipper.has_slur("my nigga"))
        self.assertFalse(clipper.has_slur("big game"))

    def test_escape(self):
        self.assertEqual(clipper.ff_escape("a:b'c%"), "a\\:b\\'c\\%")
        self.assertEqual(clipper.strip_emoji("GTA 6 😳"), "GTA 6")


if __name__ == "__main__":
    unittest.main()
