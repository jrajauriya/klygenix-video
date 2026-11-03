import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CLIENT = ROOT / "packages" / "client" / "src"
MOBILE = ROOT / "apps" / "mobile"

DOM_ONLY = {
    "sonner",
    "lucide-react",
    "react-router-dom",
    "react-dom",
    "@klygenixvideo/ui",
    "@klygenixvideo/auth",
    "@klygenixvideo/player",
    "@klygenixvideo/observe",
}

PASS = 0
FAIL = 0
ERRORS = []


def check(name, actual, expected):
    global PASS, FAIL
    if actual == expected:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        ERRORS.append(f"{name}: expected {expected!r}, got {actual!r}")
        print(f"  [FAIL] {name}: expected {expected!r}, got {actual!r}")


def source_of(name: str) -> pathlib.Path | None:
    for suffix in (".ts", ".tsx"):
        candidate = CLIENT / f"{name}{suffix}"
        if candidate.exists():
            return candidate
    return None


def closure(entry: pathlib.Path) -> tuple[set[str], list[str]]:
    stack = [m for m in re.findall(r'from "\./([\w/]+)"', entry.read_text())]
    seen: set[str] = set()
    offenders: list[str] = []
    while stack:
        name = stack.pop()
        if name in seen:
            continue
        seen.add(name)
        src = source_of(name)
        if src is None:
            continue
        for dep in re.findall(r'from "([^"]+)"', src.read_text()):
            if dep.startswith("./"):
                stack.append(dep[2:])
            elif dep in DOM_ONLY:
                offenders.append(f"{name} imports {dep}")
    return seen, offenders


print("\n=== The native entry exists and is narrow ===")
native = CLIENT / "native.ts"
check("packages/client/src/native.ts exists", native.exists(), True)

reached, offenders = closure(native)
check("it reaches no DOM-only package", offenders, [])
check("and only pure modules", reached, {"money", "dates", "app"})

print("\n=== The main barrel is NOT safe, which is why native.ts exists ===")
_, main_offenders = closure(CLIENT / "index.ts")
check(
    "the barrel does reach the DOM",
    len(main_offenders) > 0,
    True,
)

print("\n=== Mobile imports only through the narrow door ===")
sources = [
    p
    for p in MOBILE.rglob("*")
    if p.suffix in (".ts", ".tsx")
    and p.is_file()
    and "node_modules" not in p.parts
]
check("the app has source files", len(sources) > 0, True)

barrel_users = []
dom_users = []
for path in sources:
    text = path.read_text()
    for dep in re.findall(r'from "([^"]+)"', text):
        if dep.startswith("@klygenixvideo/client") and dep != "@klygenixvideo/client/src/native":
            barrel_users.append(f"{path.relative_to(ROOT)} imports {dep}")
        elif dep in DOM_ONLY:
            dom_users.append(f"{path.relative_to(ROOT)} imports {dep}")

check("none reaches for the web barrel", barrel_users, [])
check(
    "money and dates come through the native entry",
    any('"@klygenixvideo/client/src/native"' in p.read_text() for p in sources),
    True,
)
check("and none imports a DOM-only package", dom_users, [])

print("\n=== No native module outside the Expo SDK ===")
package = json.loads((MOBILE / "package.json").read_text())
deps = set(package.get("dependencies", {}))
allowed_prefixes = ("expo", "react", "@react-native", "@tanstack", "@klygenixvideo")
allowed_exact = {"axios", "react-native"}
outside = sorted(
    d
    for d in deps
    if d not in allowed_exact and not d.startswith(allowed_prefixes)
)
check(
    "every dependency is Expo, React, or already shared",
    outside,
    [],
)

print("\n=== The app declares what it shares ===")
check("@klygenixvideo/client is a dependency", "@klygenixvideo/client" in deps, True)
check("@klygenixvideo/types is a dependency", "@klygenixvideo/types" in deps, True)
check("react-native is pinned to an exact version", package["dependencies"].get("react-native", "").startswith("0."), True)

print("\n" + "=" * 52)
print(f"  PASS: {PASS}   FAIL: {FAIL}")
print("=" * 52)
if ERRORS:
    print("\n".join(ERRORS))
sys.exit(1 if FAIL else 0)
