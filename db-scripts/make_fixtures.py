import json
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tests", "fixtures", "media")

SCRIPTS = {
    "azure-apim-auth": {
        "size": (1280, 720), "pattern": "testsrc2", "title": "Azure API Management authentication explained",
        "lines": [
            "Welcome. Today we will learn how authentication works in Azure API Management.",
            "API Management sits in front of your backend services as a gateway.",
            "Why does authentication matter here? Because every request reaches the gateway first.",
            "The first option is a subscription key, sent in a header with every call.",
            "Subscription keys are simple, but they identify an app, not a user.",
            "The second option is OAuth two with Microsoft Entra ID.",
            "With OAuth, the client gets an access token and sends it as a bearer token.",
            "You validate that token in the gateway with the validate JWT policy.",
            "The validate JWT policy checks the issuer, the audience and the signature.",
            "A common mistake is forgetting to check the audience claim.",
            "If you skip the audience check, a token for another API could be accepted.",
            "The third option is client certificates, also called mutual TLS.",
            "Client certificates are useful for partner integrations between companies.",
            "You can combine methods, for example a subscription key plus a JWT.",
            "For managed identities, the gateway can call your backend without any secret.",
            "Let us recap. Use subscription keys for simple metering.",
            "Use OAuth with validate JWT for users and apps.",
            "Use client certificates for trusted partners.",
            "Thanks for watching, and see you in the next lesson about rate limiting.",
        ],
    },
    "dal-tadka": {
        "size": (1280, 720), "pattern": "smptebars", "title": "Dal tadka at home in twenty minutes",
        "lines": [
            "Hello everyone. Today we are making dal tadka at home.",
            "First, wash one cup of toor dal three times.",
            "Pressure cook the dal with turmeric and salt for four whistles.",
            "Never skip soaking if your dal is old, it cooks unevenly.",
            "Now heat ghee in a small pan for the tadka.",
            "Add cumin seeds and wait until they crackle.",
            "Then add garlic, dry red chilli and a pinch of asafoetida.",
            "The secret is to take the pan off the heat before adding chilli powder.",
            "Pour the tadka over the dal and cover it for one minute.",
            "Finish with fresh coriander and a squeeze of lemon.",
            "Serve hot with rice or roti. Enjoy your meal.",
        ],
    },
    "reel-three-tips": {
        "size": (720, 1280), "pattern": "testsrc2", "title": "Three tips to speak with confidence",
        "lines": [
            "Want to speak with confidence? Here are three quick tips.",
            "One, slow down. Fast speech sounds nervous.",
            "Two, pause after your main point.",
            "Three, look at one person at a time.",
            "Try it in your next meeting.",
        ],
    },
    "reel-git-mistake": {
        "size": (720, 1280), "pattern": "smptebars", "title": "The git mistake everyone makes",
        "lines": [
            "The biggest git mistake? Committing straight to main.",
            "Always create a branch for each change.",
            "Then open a pull request so someone can review it.",
            "Your future self will thank you.",
        ],
    },
    "reel-chai": {
        "size": (720, 1280), "pattern": "testsrc2", "title": "Masala chai in sixty seconds",
        "lines": [
            "How do you make perfect masala chai?",
            "Boil water with crushed ginger and cardamom.",
            "Add tea leaves and let it bubble for a minute.",
            "Pour in milk and sugar, then simmer until it rises.",
            "Strain and serve. That is it.",
        ],
    },
    "reframe-marker": {
        "size": (1280, 720), "pattern": "smptebars", "title": "Walking across the stage", "marker": True,
        "lines": [
            "I start on the left side of the stage.",
            "Now I walk slowly towards the middle.",
            "And I finish on the right side of the stage.",
        ],
    },
    "chai-hindi": {
        "size": (1280, 720), "pattern": "testsrc2", "title": "मसाला चाय बनाने का आसान तरीका", "voice": "Lekha",
        "lang": "hin",
        "lines": [
            "नमस्ते दोस्तों, आज हम मसाला चाय बनाना सीखेंगे।",
            "सबसे पहले पानी में अदरक और इलायची डालकर उबालें।",
            "फिर चाय की पत्ती डालें और एक मिनट तक पकाएं।",
            "अब दूध और चीनी मिलाएं और उबाल आने दें।",
            "चाय को छानकर गरम गरम परोसें।",
            "सर्दियों में थोड़ी सी काली मिर्च भी डाल सकते हैं।",
        ],
    },
}


def run(args):
    subprocess.run(args, check=True, capture_output=True)


def duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", path],
                         check=True, capture_output=True, text=True).stdout
    return float(json.loads(out)["format"]["duration"])


def ts(sec):
    ms = int(round(sec * 1000))
    h, rem = divmod(ms, 3600000)
    m, rem = divmod(rem, 60000)
    s, milli = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}.{milli:03d}"


def build(name, spec, force=False):
    target = os.path.join(OUT, f"{name}.mp4")
    if os.path.exists(target) and not force:
        return target
    work = os.path.join(OUT, f".work-{name}")
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work)
    cues, t, parts = [], 0.0, []
    for i, line in enumerate(spec["lines"]):
        aiff = os.path.join(work, f"l{i:03d}.aiff")
        run(["say", *(["-v", spec["voice"]] if spec.get("voice") else []), "-r", "185", "-o", aiff, line])
        wav = os.path.join(work, f"l{i:03d}.wav")
        run(["ffmpeg", "-y", "-v", "error", "-i", aiff, "-ar", "44100", "-ac", "1", wav])
        d = duration(wav)
        gap = 0.35
        cues.append((t, t + d, line))
        parts.append(wav)
        silence = os.path.join(work, f"s{i:03d}.wav")
        run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", str(gap), silence])
        parts.append(silence)
        t += d + gap
    listing = os.path.join(work, "list.txt")
    with open(listing, "w") as fh:
        fh.writelines(f"file '{p}'\n" for p in parts)
    audio = os.path.join(work, "audio.wav")
    run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", listing, "-c", "copy", audio])
    vtt = os.path.join(OUT, f"{name}.vtt")
    with open(vtt, "w") as fh:
        fh.write("WEBVTT\n\n")
        for a, b, text in cues:
            fh.write(f"{ts(a)} --> {ts(b)}\n{text}\n\n")
    w, h = spec["size"]
    total = t
    video = ["-map", "0:v"]
    extra = []
    if spec.get("marker"):
        extra = ["-f", "lavfi", "-i", f"color=c=0xFF00FF:size=140x140:rate=24:duration={total:.2f}"]
        video = ["-filter_complex", f"[0:v][3:v]overlay=x='100+(W-340)*t/{total:.2f}':y=(H-140)/2[v]", "-map", "[v]"]
    run([
        "ffmpeg", "-y", "-v", "error",
        "-f", "lavfi", "-i", f"{spec['pattern']}=size={w}x{h}:rate=24:duration={total:.2f}",
        "-i", audio, "-i", vtt, *extra,
        *video, "-map", "1:a", "-map", "2:s",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "96k", "-c:s", "mov_text", "-metadata:s:s:0", f"language={spec.get('lang', 'eng')}",
        "-t", f"{total:.2f}", target,
    ])
    with open(os.path.join(OUT, f"{name}.json"), "w") as fh:
        json.dump({"title": spec["title"], "duration_s": round(total, 2), "lines": spec["lines"],
                   "cues": [[round(a, 3), round(b, 3), x] for a, b, x in cues]}, fh, indent=1)
    shutil.rmtree(work, ignore_errors=True)
    return target


def main():
    os.makedirs(OUT, exist_ok=True)
    force = "--force" in sys.argv
    for name, spec in SCRIPTS.items():
        path = build(name, spec, force)
        print(f"{name}: {path} ({duration(path):.1f}s)")


if __name__ == "__main__":
    main()
