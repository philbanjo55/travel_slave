"""Label archived webcam frames clear / haze / low_cloud / fog / dark /
camera_problem with CLIP zero-shot, free and offline.

Runs nightly in GitHub Actions (.github/workflows/webcam-clip.yml). Talks only
to the webcam-labels edge function with WEBCAM_LABELLER_TOKEN; the repo is
public, so it never sees the service-role key.
"""
import io
import json
import os
import sys
import urllib.request

import torch
from PIL import Image
from transformers import CLIPModel, CLIPProcessor

ENDPOINT = "https://ohshrzlvvxyovcjmdajc.supabase.co/functions/v1/webcam-labels"
MODEL = "openai/clip-vit-base-patch16"
NIGHT_ALTITUDE = -4.0  # below this the frame is labelled dark without CLIP

# Several phrasings per label; their text embeddings are averaged.
PROMPTS = {
    "clear": [
        "a webcam photo of hills and sea on a clear day with good visibility",
        "distant mountains sharply visible under a clear or partly cloudy sky",
    ],
    "haze": [
        "a hazy webcam photo, distant hills faint and washed out",
        "misty air reducing visibility, hills still visible",
    ],
    "low_cloud": [
        "low clouds covering the tops of the hills while the lower slopes are visible",
        "mountain tops hidden in cloud",
    ],
    "fog": [
        "a webcam photo in thick fog, nothing visible in the distance",
        "dense grey fog, everything white and blank",
    ],
    "dark": [
        "a dark night-time webcam image",
        "a black and white infrared night image",
    ],
    "camera_problem": [
        "a blurry webcam image with raindrops on the lens",
        "a broken, blank or frozen camera image",
    ],
}


def call(method, path="", body=None):
    req = urllib.request.Request(
        ENDPOINT + path,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"x-labeller-token": os.environ["LABELLER_TOKEN"], "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def main():
    frames = call("GET", "?limit=300").get("frames", [])
    print(f"{len(frames)} frames to label")
    if not frames:
        return

    model = CLIPModel.from_pretrained(MODEL).eval()
    proc = CLIPProcessor.from_pretrained(MODEL)
    labels = list(PROMPTS)
    with torch.no_grad():
        text = proc(text=[p for l in labels for p in PROMPTS[l]], return_tensors="pt", padding=True)
        t = model.get_text_features(**text)
        t = t / t.norm(dim=-1, keepdim=True)
        per = len(PROMPTS["clear"])
        t = torch.stack([t[i * per:(i + 1) * per].mean(0) for i in range(len(labels))])
        t = t / t.norm(dim=-1, keepdim=True)

    results = []
    for f in frames:
        alt = f.get("sun_altitude")
        if alt is not None and alt < NIGHT_ALTITUDE:
            results.append({"id": f["id"], "clip_label": "dark", "clip_scores": None,
                            "clip_model": "sun_altitude", "sun_altitude": alt})
            continue
        try:
            with urllib.request.urlopen(f["url"], timeout=60) as r:
                img = Image.open(io.BytesIO(r.read())).convert("RGB")
        except Exception as e:  # noqa: BLE001 - one bad frame must not stop the run
            print(f"skip {f['camera_code']} {f['captured_at']}: {e}")
            continue
        with torch.no_grad():
            v = model.get_image_features(**proc(images=img, return_tensors="pt"))
            v = v / v.norm(dim=-1, keepdim=True)
            probs = (model.logit_scale.exp() * v @ t.T).softmax(-1)[0].tolist()
        scores = {l: round(p, 4) for l, p in zip(labels, probs)}
        best = max(scores, key=scores.get)
        results.append({"id": f["id"], "clip_label": best, "clip_scores": scores,
                        "clip_model": MODEL, "sun_altitude": alt})
        print(f"{f['camera_code']} {f['captured_at']} sun {alt}: {best} {scores}")

    for i in range(0, len(results), 100):
        print(call("POST", body={"results": results[i:i + 100]}))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        print(f"labeller failed: {e}", file=sys.stderr)
        raise
