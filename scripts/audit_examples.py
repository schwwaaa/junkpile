#!/usr/bin/env python3
"""Audit Junkpile catalog projects without compiling or launching Tauri.

Checks repository shape, Tauri/Cargo/CLI generation agreement, configured
frontend entry points, local HTML references, and JavaScript syntax when Node is
available. Projects are discovered through docs/examples.json so v1, v2, and
wgpu stay aligned with the public documentation catalog.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tomllib
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]


@dataclass
class Result:
    project: str
    expected_major: int | None
    cargo_major: int | None
    cli_major: int | None
    schema_major: int | None
    window_count: int
    javascript_files: int
    readme: bool
    ok: bool
    issues: list[str]


def dependency_major(value: Any) -> int | None:
    if isinstance(value, dict):
        value = value.get("version")
    if not isinstance(value, str):
        return None
    match = re.search(r"(\d+)", value)
    return int(match.group(1)) if match else None


def strip_html_comments(text: str) -> str:
    return re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL)


def local_html_issues(src_dir: Path) -> list[str]:
    issues: list[str] = []
    for page in sorted(src_dir.glob("*.html")):
        text = strip_html_comments(page.read_text(errors="replace"))
        for attr in ("src", "href"):
            for value in re.findall(rf"\b{attr}=[\"']([^\"']+)", text, re.I):
                if value.startswith(("http://", "https://", "data:", "#", "tauri:", "javascript:")):
                    continue
                clean = value.split("?", 1)[0].split("#", 1)[0]
                if clean and not (page.parent / clean).exists():
                    issues.append(f"{page.relative_to(ROOT)} references missing {value}")
    return issues


def configured_windows(config: dict[str, Any], major: int | None) -> list[dict[str, Any]]:
    if major == 1:
        return config.get("tauri", {}).get("windows", [])
    if major == 2:
        return config.get("app", {}).get("windows", [])
    return []


def audit_project(project: Path, expected_major: int | None, node: str | None) -> Result:
    issues: list[str] = []
    required = [
        project / "package.json",
        project / "src-tauri" / "Cargo.toml",
        project / "src-tauri" / "tauri.conf.json",
        project / "src",
        project / "README.md",
    ]
    for item in required:
        if not item.exists():
            issues.append(f"missing {item.relative_to(ROOT)}")

    cargo_major = cli_major = schema_major = None
    windows: list[dict[str, Any]] = []

    try:
        cargo = tomllib.loads((project / "src-tauri" / "Cargo.toml").read_text())
        cargo_major = dependency_major(cargo.get("dependencies", {}).get("tauri"))
    except Exception as exc:
        issues.append(f"Cargo.toml parse failed: {exc}")

    try:
        package = json.loads((project / "package.json").read_text())
        cli_major = dependency_major(package.get("devDependencies", {}).get("@tauri-apps/cli"))
    except Exception as exc:
        issues.append(f"package.json parse failed: {exc}")

    try:
        config = json.loads((project / "src-tauri" / "tauri.conf.json").read_text())
        schema = config.get("$schema", "")
        match = re.search(r"config/(\d+)", schema)
        schema_major = int(match.group(1)) if match else None
        windows = configured_windows(config, expected_major or cargo_major)
        for window in windows:
            url = window.get("url", "index.html")
            if isinstance(url, str) and not url.startswith(("http://", "https://")):
                if not (project / "src" / url).exists():
                    issues.append(f"configured window URL does not exist: {url}")
    except Exception as exc:
        issues.append(f"tauri.conf.json parse failed: {exc}")

    if expected_major is not None:
        if cargo_major != expected_major:
            issues.append(f"Cargo Tauri major is {cargo_major}, expected {expected_major}")
        if cli_major != expected_major:
            issues.append(f"npm Tauri CLI major is {cli_major}, expected {expected_major}")
        if schema_major not in (None, expected_major):
            issues.append(f"config schema major is {schema_major}, expected {expected_major}")

    src_dir = project / "src"
    js_files = sorted(src_dir.glob("*.js")) if src_dir.exists() else []
    if src_dir.exists():
        issues.extend(local_html_issues(src_dir))

    if node:
        for js in js_files:
            proc = subprocess.run([node, "--check", str(js)], capture_output=True, text=True)
            if proc.returncode:
                message = (proc.stderr or proc.stdout).strip().splitlines()
                issues.append(f"JavaScript parse failed: {js.relative_to(ROOT)}: {message[-1] if message else 'unknown error'}")

    return Result(
        project=str(project.relative_to(ROOT)),
        expected_major=expected_major,
        cargo_major=cargo_major,
        cli_major=cli_major,
        schema_major=schema_major,
        window_count=len(windows),
        javascript_files=len(js_files),
        readme=(project / "README.md").exists(),
        ok=not issues,
        issues=issues,
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    catalog = json.loads((ROOT / "docs" / "examples.json").read_text())["examples"]
    node = shutil.which("node")
    results = []
    for entry in catalog:
        project = ROOT / entry["path"]
        results.append(audit_project(project, entry.get("tauri_major"), node))

    if args.json:
        print(json.dumps([asdict(r) for r in results], indent=2))
    else:
        print("Junkpile catalog audit")
        print("status  project                                          cargo cli schema windows js")
        print("------  -----------------------------------------------  ----- --- ------ ------- --")
        for result in results:
            status = "PASS" if result.ok else "FAIL"
            print(f"{status:6}  {result.project:47}  {str(result.cargo_major):5} {str(result.cli_major):3} {str(result.schema_major):6} {result.window_count:7} {result.javascript_files:2}")
            for issue in result.issues:
                print(f"        - {issue}")
        print("Node.js syntax checks:", "enabled" if node else "skipped (node not found)")

    return 0 if all(r.ok for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
