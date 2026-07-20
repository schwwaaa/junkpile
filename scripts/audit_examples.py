#!/usr/bin/env python3
"""Audit Junkpile example metadata and basic source integrity.

This script does not compile Rust or launch Tauri. It verifies the repository
shape that can be checked without platform toolchains:

- every example has package.json, Cargo.toml, tauri.conf.json, src/, and README
- the folder generation, Cargo Tauri major, CLI major, and config schema agree
- configured window URLs resolve to bundled frontend files
- JavaScript parses when Node.js is available
- local HTML script/link references resolve

Usage:
    python3 scripts/audit_examples.py
    python3 scripts/audit_examples.py --json
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
    expected_major: int
    cargo_major: int | None
    cli_major: int | None
    schema_major: int | None
    window_count: int
    javascript_files: int
    readme: bool
    ok: bool
    issues: list[str]


def dependency_major(value: Any) -> int | None:
    """Extract a leading major version from a Cargo/npm dependency value."""
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
    for html in sorted(src_dir.glob("*.html")):
        text = strip_html_comments(html.read_text(errors="replace"))
        for attr in ("src", "href"):
            for value in re.findall(rf"\b{attr}=[\"']([^\"']+)", text, re.I):
                if value.startswith(("http://", "https://", "data:", "#", "tauri:")):
                    continue
                clean = value.split("?", 1)[0].split("#", 1)[0]
                if clean and not (html.parent / clean).exists():
                    issues.append(f"{html.relative_to(ROOT)} references missing {value}")
    return issues


def configured_windows(config: dict[str, Any], major: int) -> list[dict[str, Any]]:
    if major == 1:
        return config.get("tauri", {}).get("windows", [])
    return config.get("app", {}).get("windows", [])


def audit_project(project: Path, expected_major: int, node: str | None) -> Result:
    issues: list[str] = []
    required = [
        project / "package.json",
        project / "src-tauri" / "Cargo.toml",
        project / "src-tauri" / "tauri.conf.json",
        project / "src-tauri" / "src" / "main.rs",
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
        windows = configured_windows(config, expected_major)
        for window in windows:
            url = window.get("url", "index.html")
            if isinstance(url, str) and not url.startswith(("http://", "https://")):
                if not (project / "src" / url).exists():
                    issues.append(f"configured window URL does not exist: {url}")
    except Exception as exc:
        issues.append(f"tauri.conf.json parse failed: {exc}")

    if cargo_major != expected_major:
        issues.append(f"Cargo Tauri major is {cargo_major}, expected {expected_major}")
    if cli_major != expected_major:
        issues.append(f"npm Tauri CLI major is {cli_major}, expected {expected_major}")
    if schema_major != expected_major:
        issues.append(f"config schema major is {schema_major}, expected {expected_major}")

    src_dir = project / "src"
    js_files = sorted(src_dir.glob("*.js")) if src_dir.exists() else []
    issues.extend(local_html_issues(src_dir) if src_dir.exists() else [])

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
    parser.add_argument("--json", action="store_true", help="print machine-readable JSON")
    args = parser.parse_args()

    node = shutil.which("node")
    results: list[Result] = []
    for expected_major in (1, 2):
        version_dir = ROOT / f"v{expected_major}"
        for project in sorted(p for p in version_dir.iterdir() if p.is_dir()):
            if (project / "package.json").exists():
                results.append(audit_project(project, expected_major, node))

    if args.json:
        print(json.dumps([asdict(result) for result in results], indent=2))
    else:
        print(f"Audited {len(results)} Junkpile examples")
        print("status  project                                          cargo cli schema windows js")
        print("------  -----------------------------------------------  ----- --- ------ ------- --")
        for result in results:
            status = "PASS" if result.ok else "FAIL"
            print(
                f"{status:6}  {result.project:47}  "
                f"{str(result.cargo_major):5} {str(result.cli_major):3} "
                f"{str(result.schema_major):6} {result.window_count:7} {result.javascript_files:2}"
            )
            for issue in result.issues:
                print(f"        - {issue}")
        print()
        print("Node.js syntax checks:", "enabled" if node else "skipped (node not found)")

    return 0 if all(result.ok for result in results) else 1


if __name__ == "__main__":
    sys.exit(main())
