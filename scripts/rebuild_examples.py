#!/usr/bin/env python3
"""Rebuild docs/examples.json from the current Junkpile repository tree.

This script does not rename or modify application projects. It derives public
catalog metadata from folder names, local READMEs, Cargo metadata, and the
presence of validation documents. Historical repair copies can remain in the
source tree while being omitted from the public catalog.
"""
from __future__ import annotations

import json
import re
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP_PUBLIC = {"wgpu/19-wgpu-gesture-field-wgsl-keyword-fix"}


def dependency_major(value):
    if isinstance(value, dict):
        value = value.get("version")
    if not isinstance(value, str):
        return None
    match = re.search(r"(\d+)", value)
    return int(match.group(1)) if match else None


def tauri_major(project: Path) -> int | None:
    cargo = project / "src-tauri" / "Cargo.toml"
    if not cargo.exists():
        return None
    try:
        data = tomllib.loads(cargo.read_text())
        return dependency_major(data.get("dependencies", {}).get("tauri"))
    except Exception:
        return None


def heading_and_summary(readme: Path) -> tuple[str, str]:
    if not readme.exists():
        return "", ""
    text = readme.read_text(errors="ignore")
    match = re.search(r"^#\s+(.+)$", text, re.M)
    heading = match.group(1).strip() if match else ""
    summary = ""
    for chunk in re.split(r"\n\s*\n", text):
        compact = " ".join(line.strip() for line in chunk.splitlines()).strip()
        if not compact or compact.startswith(("#", "```", "**Folder:**", "<")):
            continue
        compact = re.sub(r"\*\*(.*?)\*\*", r"\1", compact)
        compact = re.sub(r"`([^`]+)`", r"\1", compact)
        if len(compact) > 20:
            summary = compact
            break
    if len(summary) > 340:
        summary = summary[:337].rstrip() + "…"
    return heading, summary


def title_for(folder: str, heading: str) -> str:
    overrides = {
        "09-wgpu-compute-particles-additive-blend": "Compute Particles · Additive Blend",
        "19-wgpu-gesture-field": "Gesture Field",
        "42-wgpu-audio-reactive-fft": "Audio-Reactive FFT",
        "43-wgpu-av-recorder": "AV Recorder",
        "44-wgpu-wgsl-shader-playground": "WGSL Shader Playground",
    }
    if folder in overrides:
        return overrides[folder]
    title = heading or folder[3:].replace("-", " ").title()
    title = re.sub(r"^Junkpile\s+", "", title, flags=re.I)
    title = re.sub(r"^Example\s+", "", title, flags=re.I)
    title = re.sub(r"^\d{2}(?:\.\d+)?\s*[·—-]\s*", "", title)
    title = re.sub(r"^wgpu\s+", "", title, flags=re.I)
    if not title or "verification build" in title.lower():
        title = folder[3:].replace("-", " ").title()
    return title.strip()


def family_for(folder: str, collection: str) -> str:
    f = folder.lower()
    if "wgpu" in f and collection != "wgpu":
        if "ultra-resolution" in f:
            return "export"
        return "native-wgpu"
    if collection in {"v1", "v2"}:
        rules = [
            ("midi", ["midi"]), ("osc", ["osc"]), ("camera", ["webcam"]),
            ("feedback", ["feedback"]), ("glsl", ["glsl-", "shader-playground"]),
            ("webgl", ["webgl-"]), ("p5", ["p5-"]),
            ("video", ["video-texture", "live-video"]),
            ("audio", ["audio-reactive", "audio-file"]),
            ("recording", ["canvas-recorder"]),
            ("compositing", ["compositor", "texture-mixer"]),
            ("image", ["image-texture", "image-sequence"]),
            ("projection", ["projection"]), ("automation", ["keyframe"]),
            ("display", ["multi-display"]), ("export", ["ultra-resolution"]),
        ]
        for key, terms in rules:
            if any(term in f for term in terms):
                return key
        return "application"

    # Native wgpu ordering matters for names that contain "wgsl-shader".
    if "wgsl-shader-playground" in f or "shader-parameter" in f:
        return "shader-tooling"
    if any(x in f for x in ["surface-probe", "resize-fullscreen", "wgsl-shader", "tauri-controls", "backend-lab", "multipass-render-graph", "high-resolution-lab"]):
        return "foundation"
    if "image-texture" in f: return "image"
    if any(x in f for x in ["compute-fluid", "voxel-feedback", "ping-pong-feedback", "mesh-feedback"]): return "feedback-compute"
    if "compute-particles" in f or "particle-volume" in f: return "compute"
    if "raymarch" in f: return "3d"
    if "webcam" in f: return "camera"
    if "video-decoder" in f: return "video"
    if "audio-reactive" in f: return "audio"
    if "midi" in f: return "midi"
    if "osc" in f: return "osc"
    if "gesture" in f: return "interaction"
    if "multi-input" in f: return "compositing"
    if any(x in f for x in ["gltf", "skeletal", "morph-target"]): return "3d"
    if "ultra-resolution-export" in f: return "export"
    if any(x in f for x in ["io-config", "frame-output", "io-profile"]): return "io-foundation"
    if any(x in f for x in ["ffmpeg-record", "high-resolution-record", "av-recorder"]): return "recording"
    if "ndi" in f: return "ndi"
    if "preview-output" in f: return "preview"
    if "assets-state-logging" in f or "appliance-runtime" in f: return "runtime"
    if any(x in f for x in ["runtime-output-router", "cross-platform-output-router"]): return "routing"
    if "syphon" in f: return "syphon"
    if "spout" in f: return "spout"
    if "network-output" in f: return "network"
    return "native-wgpu"


def topology_for(folder: str, collection: str) -> str:
    f = folder.lower()
    if "wgpu" in f and collection != "wgpu":
        return "native-window"
    if collection in {"v1", "v2"}:
        return "two-window" if any(x in f for x in ["-ws-", "projection-mapper", "image-sequence-player"]) else "single-window"
    if any(x in f for x in [
        "surface-probe", "resize-fullscreen", "wgsl-shader", "image-texture",
        "ping-pong-feedback", "multipass-render-graph", "high-resolution-lab",
        "backend-lab", "compute-particles", "3d-particle", "volumetric",
        "compute-fluid", "voxel", "ultra-resolution-export",
    ]):
        return "native-window"
    return "hybrid-controls-native-renderer"


def status_for(folder: str, collection: str) -> str:
    if collection == "wgpu":
        return {
            "40-wgpu-network-output": "unresolved-under-review",
            "43-wgpu-av-recorder": "working-baseline",
            "37-wgpu-syphon-sender": "macos-specific",
            "38-wgpu-spout-sender": "windows-specific",
            "32-wgpu-ndi-sender": "ndi-sdk-required",
        }.get(folder, "documented-current")
    return "documented-current"


def platforms_for(folder: str) -> list[str]:
    f = folder.lower()
    if "avfoundation" in f or "syphon" in f:
        return ["macOS"]
    if "spout" in f:
        return ["Windows"]
    return ["macOS", "Windows", "Linux"]


def main() -> None:
    examples = []
    for collection in ("v1", "v2", "wgpu"):
        for project in sorted(p for p in (ROOT / collection).iterdir() if p.is_dir()):
            rel = f"{collection}/{project.name}"
            if rel in SKIP_PUBLIC:
                continue
            match = re.match(r"^(\d{2})-", project.name)
            if not match:
                continue
            heading, summary = heading_and_summary(project / "README.md")
            validation = project / "VALIDATION.md"
            examples.append({
                "number": match.group(1),
                "id": project.name,
                "path": rel,
                "collection": collection,
                "tauri_major": tauri_major(project),
                "title": title_for(project.name, heading),
                "summary": summary,
                "family": family_for(project.name, collection),
                "topology": topology_for(project.name, collection),
                "status": status_for(project.name, collection),
                "platforms": platforms_for(project.name),
                "documentation": f"{rel}/README.md",
                "validation_document": f"{rel}/VALIDATION.md" if validation.exists() else None,
            })

    payload = {
        "schema_version": 3,
        "generated_on": "2026-08-28",
        "note": "Catalog paths and titles are derived from the repository tree. Historical repair copies can remain in source without becoming separate public examples.",
        "collections": {
            "v1": {"label": "Tauri v1 directory", "path": "v1/"},
            "v2": {"label": "Tauri v2 WebView", "path": "v2/"},
            "wgpu": {
                "label": "Native Rust/wgpu",
                "path": "wgpu/",
                "numbering_note": "29 is absent in the current tree; 19-wgpu-gesture-field is canonical and the historical WGSL-keyword-fix repair copy is omitted from the public catalog.",
            },
        },
        "examples": examples,
    }
    (ROOT / "docs" / "examples.json").write_text(json.dumps(payload, indent=2) + "\n")
    print("Rebuilt docs/examples.json")


if __name__ == "__main__":
    main()
