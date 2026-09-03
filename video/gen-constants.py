import json
t = json.load(open("build/timings.json"))
order = ["hook","problem","terminal","interface","evidence","close"]
FPS, GAP = 30, 45
def lit(v): return json.dumps(v, ensure_ascii=False)
audio_lines = "\n".join("  %s: %d," % (k, t[k]['frames']) for k in order)
scene_lines = "\n".join("  %s: AUDIO_DURATIONS.%s + SCENE_GAP," % (k, k) for k in order)
audio_files = "\n".join('  %s: "audio/%s.mp3",' % (k, k) for k in order)
subs = "\n".join(
    "  %s: [\n%s\n  ]," % (k, "\n".join(
        '    { text: %s, start: %d, end: %d },' % (lit(s["text"]), s["start"], s["end"]) for s in t[k]["subs"]))
    for k in order)
tmpl = open("constants.template").read()
out = tmpl.replace("@AUDIO@", audio_lines).replace("@SCENES@", scene_lines) \
          .replace("@FILES@", audio_files).replace("@SUBS@", subs) \
          .replace("@ORDER@", ", ".join(lit(k) for k in order))
open("src/constants.ts","w").write(out)
total = sum(t[k]["frames"] + GAP for k in order) - 15*(len(order)-1)
print("constants.ts written | TOTAL_FRAMES =", total, "= %.1fs" % (total/FPS))
