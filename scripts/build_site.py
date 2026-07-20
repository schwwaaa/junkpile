#!/usr/bin/env python3
"""Build the static Junkpile landing and documentation pages.

The site is intentionally framework-free. It reads docs/examples.json so the
web catalog and repository catalog remain aligned, then emits root index.html
and docs.html files that work when opened directly or hosted by GitHub Pages.
"""
from __future__ import annotations

import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXAMPLES = json.loads((ROOT / "docs" / "examples.json").read_text())["examples"]

FAMILY = {
    "p5": {
        "title": "p5.js",
        "short": "The quickest path from a creative sketch to a desktop app.",
        "description": "p5.js creates the WEBGL canvas, manages the animation loop, compiles embedded shader strings, and uploads uniforms through a compact creative-coding API.",
        "learn": "Canvas creation, shader uniforms, p5's draw loop, and lightweight UI binding.",
        "start": "Start here when speed of iteration matters more than seeing every WebGL primitive.",
        "color": "signal",
    },
    "webgl": {
        "title": "Raw WebGL",
        "short": "The browser graphics pipeline with every important step visible.",
        "description": "These examples request a WebGL context, compile and link shaders, create a full-screen quad, locate uniforms, resize the viewport, and issue draw calls without a graphics framework.",
        "learn": "Shader compilation, program linking, buffers, uniforms, viewport management, and draw calls.",
        "start": "Use this family when you want the clearest low-level browser GPU baseline.",
        "color": "blue",
    },
    "glsl": {
        "title": "External GLSL",
        "short": "Raw WebGL with shader source kept in a separate file.",
        "description": "The fragment shader lives in shader.frag and is loaded at runtime. This isolates shader authoring from host JavaScript and introduces explicit loading and compile-error handling.",
        "learn": "Runtime asset loading, shader iteration, compiler errors, and code separation.",
        "start": "Choose this when the shader itself is the primary artifact or future editor target.",
        "color": "orange",
    },
    "webcam": {
        "title": "Webcam",
        "short": "Live camera capture uploaded into a WebGL texture every frame.",
        "description": "JavaScript requests camera access with getUserMedia, routes the stream through a hidden video element, and uploads each ready frame into a GPU texture for real-time processing.",
        "learn": "Permissions, MediaDevices, video readiness, texture upload, camera selection, and live effects.",
        "start": "Use this baseline for camera-reactive tools, installations, and visual instruments.",
        "color": "orange",
    },
    "feedback": {
        "title": "Feedback",
        "short": "Stateful image processing with alternating framebuffer textures.",
        "description": "Two framebuffer textures alternate roles. Each frame samples the previous state and webcam texture, writes the next state, displays it, then swaps references.",
        "learn": "Ping-pong framebuffers, persistent GPU state, simulation/display separation, and state reset on resize.",
        "start": "This is the advanced baseline for trails, datamosh, reaction systems, and recursive image processes.",
        "color": "signal",
    },
    "midi": {
        "title": "MIDI",
        "short": "Native hardware control routed from Rust into a p5.js renderer.",
        "description": "Rust uses midir to enumerate ports and receive messages because Web MIDI support is inconsistent across desktop WebViews. Structured events are then emitted to JavaScript.",
        "learn": "Native device enumeration, MIDI bytes, Rust-to-WebView events, and control mapping.",
        "start": "Choose this for knobs, faders, notes, pitch bend, and performance controllers.",
        "color": "blue",
    },
    "osc": {
        "title": "OSC",
        "short": "Network control over UDP for creative software ecosystems.",
        "description": "Rust binds UDP port 9000 with Tokio, decodes OSC packets with rosc, and emits messages into JavaScript, where addresses are mapped to visual parameters.",
        "learn": "UDP listeners, OSC addresses, packet decoding, event emission, and network control mapping.",
        "start": "Use this with TouchOSC, Max, Pure Data, SuperCollider, TouchDesigner, or another network controller.",
        "color": "blue",
    },
}

TOPOLOGY = {
    "single-window": {
        "label": "Single window",
        "short": "Controls and renderer share one JavaScript context.",
        "flow": "DOM → params → render loop → WebGL canvas",
    },
    "two-window-websocket": {
        "label": "Two-window WS",
        "short": "Controls and canvas are separate windows connected through a Rust loopback relay.",
        "flow": "controls.js → Rust :2727 → canvas.js → render loop",
    },
}


def e(value: object) -> str:
    return html.escape(str(value), quote=True)


def pretty_id(example_id: str) -> str:
    return example_id.replace("-template", "").replace("-", " ").title()


def input_label(ex: dict) -> str:
    if ex.get("native_input"):
        return ex["native_input"]
    if ex.get("uses_camera"):
        return "Webcam"
    if ex["topology"] == "two-window-websocket":
        return "WebSocket controls"
    return "DOM controls"


def version_pair(ex: dict) -> str | None:
    family = ex["family"]
    topology = ex["topology"]
    target_version = 2 if ex["tauri_major"] == 1 else 1
    for other in EXAMPLES:
        if other["tauri_major"] == target_version and other["family"] == family and other["topology"] == topology:
            return other["path"]
    return None


def example_card(ex: dict, detailed: bool = False) -> str:
    family = FAMILY[ex["family"]]
    version = f"v{ex['tauri_major']}"
    topo = TOPOLOGY[ex["topology"]]
    hardware = ex.get("native_input")
    badges = [
        f'<span class="badge {version}">Tauri {version}</span>',
        f'<span class="badge">{e(family["title"])}</span>',
        f'<span class="badge">{e(topo["label"])}</span>',
    ]
    if ex.get("uses_camera"):
        badges.append('<span class="badge camera">Camera</span>')
    if hardware:
        badges.append(f'<span class="badge hardware">{e(hardware)}</span>')
    badges.append('<span class="badge status">Static reviewed</span>')
    pair = version_pair(ex)
    pair_link = f'<a class="mini-button" href="./{e(pair)}/README.md">Paired version</a>' if pair else ''
    extra = ""
    if detailed:
        deps = ", ".join(ex.get("rust_dependencies", [])) or "tauri"
        ports = []
        if ex.get("websocket_port"):
            ports.append(f"TCP {ex['websocket_port']}")
        if ex.get("udp_port"):
            ports.append(f"UDP {ex['udp_port']}")
        port_text = ", ".join(ports) if ports else "None fixed"
        command_id = "cmd-" + ex["id"]
        extra = f'''
        <details>
          <summary>Run and inspect this example</summary>
          <div class="details-body">
            <p><strong>What to learn:</strong> {e(family['learn'])}</p>
            <p><strong>Runtime flow:</strong> <code>{e(topo['flow'])}</code></p>
            <p><strong>Rust dependencies:</strong> <code>{e(deps)}</code></p>
            <p><strong>Fixed ports:</strong> {e(port_text)}</p>
            <div class="code-shell">
              <div class="code-label"><span>terminal</span><button class="copy-button" data-copy="#{command_id}">Copy</button></div>
              <pre id="{command_id}"><code>cd {e(ex['path'])}
npm install
npm run dev</code></pre>
            </div>
          </div>
        </details>'''
    search = " ".join([ex["id"], family["title"], family["description"], topo["label"], input_label(ex), ex["renderer"]])
    return f'''
    <article class="example-card" data-example-card data-version="{version}" data-family="{e(ex['family'])}" data-topology="{e(ex['topology'])}" data-search="{e(search.lower())}">
      <div class="example-card-head">
        <div class="badge-row">{''.join(badges)}</div>
        <h3>{e(ex['id'])}</h3>
      </div>
      <div class="example-card-body">
        <p>{e(family['short'])} {e(topo['short'])}</p>
        <dl class="example-meta">
          <dt>Renderer</dt><dd>{e(ex['renderer'])}</dd>
          <dt>Input</dt><dd>{e(input_label(ex))}</dd>
          <dt>Windows</dt><dd>{e(', '.join(ex['window_labels']))}</dd>
        </dl>
        {extra}
        <div class="example-actions">
          <a class="mini-button" href="./{e(ex['documentation'])}">Read README</a>
          <a class="mini-button" href="https://github.com/schwwaaa/junkpile/tree/main/{e(ex['path'])}" target="_blank" rel="noreferrer">View source</a>
          {pair_link}
        </div>
      </div>
    </article>'''


def filter_panel() -> str:
    family_buttons = ['<button class="filter-button is-active" aria-pressed="true" data-filter-key="family" data-filter-value="all">All families</button>']
    for key in ["p5", "webgl", "glsl", "webcam", "feedback", "midi", "osc"]:
        family_buttons.append(f'<button class="filter-button" aria-pressed="false" data-filter-key="family" data-filter-value="{key}">{e(FAMILY[key]["title"])}</button>')
    return f'''
    <div class="filter-panel">
      <div>
        <label class="search-field"><span aria-hidden="true">⌕</span><input data-example-search type="search" placeholder="Search examples, renderers, inputs…" aria-label="Search examples"></label>
        <div class="filter-group" style="margin-top:12px">
          <span class="filter-label">Tauri generation</span>
          <button class="filter-button is-active" aria-pressed="true" data-filter-key="version" data-filter-value="all">All</button>
          <button class="filter-button" aria-pressed="false" data-filter-key="version" data-filter-value="v1">V1</button>
          <button class="filter-button" aria-pressed="false" data-filter-key="version" data-filter-value="v2">V2</button>
        </div>
        <div class="filter-group" style="margin-top:10px">
          <span class="filter-label">Rendering / input family</span>
          {''.join(family_buttons)}
        </div>
        <div class="filter-group" style="margin-top:10px">
          <span class="filter-label">Window topology</span>
          <button class="filter-button is-active" aria-pressed="true" data-filter-key="topology" data-filter-value="all">All</button>
          <button class="filter-button" aria-pressed="false" data-filter-key="topology" data-filter-value="single-window">Single</button>
          <button class="filter-button" aria-pressed="false" data-filter-key="topology" data-filter-value="two-window-websocket">Two-window WS</button>
        </div>
      </div>
      <div class="filter-count" data-filter-count>{len(EXAMPLES)} examples</div>
    </div>'''


def head(title: str, description: str) -> str:
    return f'''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="{e(description)}">
  <meta name="theme-color" content="#11110f">
  <title>{e(title)}</title>
  <link rel="icon" href="assets/icons/icon_32x32.png" sizes="32x32">
  <link rel="stylesheet" href="assets/site/site.css">
  <script src="assets/site/site.js" defer></script>
</head>'''


def header(current: str) -> str:
    links = [
        ("index.html", "Overview", "index"),
        ("docs.html", "Documentation", "docs"),
        ("docs.html#example-catalog", "Examples", "examples"),
        ("README.md", "README", "readme"),
    ]
    nav = "".join(f'<a href="{href}" {"aria-current=\"page\"" if key == current else ""}>{label}</a>' for href, label, key in links)
    return f'''
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header">
  <div class="header-inner">
    <a class="brand" href="index.html"><span class="brand-mark">JP</span><span>junkpile<small>Tauri graphics baselines</small></span></a>
    <button class="nav-toggle" data-nav-toggle aria-expanded="false" aria-controls="site-nav">Menu</button>
    <nav class="site-nav" id="site-nav" data-site-nav aria-label="Primary navigation">{nav}</nav>
  </div>
</header>'''


def footer() -> str:
    return '''<footer class="site-footer">
  <div class="container footer-grid">
    <div>
      <h2>Build from a known baseline.</h2>
      <p class="footer-note">Junkpile keeps graphics, input, transport, and Tauri-generation decisions visible so developers can change one layer without guessing what the others are doing.</p>
    </div>
    <div>
      <h3>Start</h3>
      <ul class="footer-links">
        <li><a href="docs.html#quick-start">Quick start</a></li>
        <li><a href="docs.html#choose-example">Choose an example</a></li>
        <li><a href="docs.html#example-catalog">All examples</a></li>
      </ul>
    </div>
    <div>
      <h3>Reference</h3>
      <ul class="footer-links">
        <li><a href="docs/AUDIT.md">Repository audit</a></li>
        <li><a href="docs/examples.json">Example database</a></li>
        <li><a href="docs/ROADMAP.md">Roadmap</a></li>
        <li><a href="LICENSE">MIT license</a></li>
      </ul>
    </div>
  </div>
</footer>'''


def architecture_diagram() -> str:
    return '''<div class="diagram" role="img" aria-label="Shared Junkpile application layers from input through the operating system">
      <p class="diagram-title">Shared runtime stack</p>
      <div class="flow">
        <div class="flow-node signal"><strong>Input</strong><small>DOM · camera · MIDI · OSC</small></div>
        <div class="flow-arrow" aria-hidden="true">→</div>
        <div class="flow-node"><strong>Application state</strong><small>JavaScript params or Rust events</small></div>
        <div class="flow-arrow" aria-hidden="true">→</div>
        <div class="flow-node blue"><strong>Render loop</strong><small>p5 draw() or requestAnimationFrame()</small></div>
        <div class="flow-arrow" aria-hidden="true">→</div>
        <div class="flow-node orange"><strong>WebGL</strong><small>shader · texture · framebuffer</small></div>
        <div class="flow-arrow" aria-hidden="true">→</div>
        <div class="flow-node dark"><strong>Tauri WebView</strong><small>WKWebView · WebView2 · WebKitGTK</small></div>
      </div>
      <p class="flow-note"><strong>Rust sits beside this path:</strong> it starts Tauri, owns native integrations when needed, and hosts the relay used by two-window examples.</p>
    </div>'''


def topology_diagrams() -> str:
    return '''<div class="grid-2">
      <div class="diagram">
        <p class="diagram-title">Single-window architecture</p>
        <div class="flow vertical">
          <div class="flow-node signal"><strong>1. User changes a control</strong><small>slider · button · select</small></div>
          <div class="flow-arrow" aria-hidden="true">↓</div>
          <div class="flow-node"><strong>2. Handler writes params</strong><small>same JavaScript context</small></div>
          <div class="flow-arrow" aria-hidden="true">↓</div>
          <div class="flow-node blue"><strong>3. Render loop reads state</strong><small>next animation frame</small></div>
          <div class="flow-arrow" aria-hidden="true">↓</div>
          <div class="flow-node dark"><strong>4. Canvas draws</strong><small>one Tauri window</small></div>
        </div>
      </div>
      <div class="diagram">
        <p class="diagram-title">Two-window WebSocket architecture</p>
        <div class="flow vertical">
          <div class="flow-node signal"><strong>1. Controls window</strong><small>sends JSON to 127.0.0.1:2727</small></div>
          <div class="flow-arrow" aria-hidden="true">↓</div>
          <div class="flow-node orange"><strong>2. Rust relay</strong><small>broadcasts to the other client</small></div>
          <div class="flow-arrow" aria-hidden="true">↓</div>
          <div class="flow-node blue"><strong>3. Canvas window</strong><small>updates its local params</small></div>
          <div class="flow-arrow" aria-hidden="true">↓</div>
          <div class="flow-node dark"><strong>4. Visual output</strong><small>independent display placement</small></div>
        </div>
      </div>
    </div>'''


def index_page() -> str:
    cards = "".join(example_card(ex) for ex in EXAMPLES)
    family_cards = "".join(f'''
      <article class="card">
        <span class="card-tag">{e(info['title'])} family</span>
        <h3>{e(info['short'])}</h3>
        <p>{e(info['description'])}</p>
        <a class="card-link" href="docs.html#family-{key}">Explore {e(info['title'])} →</a>
      </article>''' for key, info in FAMILY.items())
    return f'''{head("Junkpile · Tauri graphics baselines", "A documented library of Tauri v1 and v2 graphics, webcam, MIDI, OSC, WebGL, GLSL, and feedback examples.")}
<body>
{header('index')}
<main id="main">
  <section class="hero">
    <div class="container hero-grid">
      <div>
        <p class="eyebrow">Coding templates for live visual art</p>
        <h1 class="display">Start fast.<br><span class="outline">Learn deeply.</span></h1>
        <p class="lede">Junkpile is a library of small, inspectable Tauri applications. Run a known baseline in minutes, understand every layer when you are ready, then turn it into your own visual tool.</p>
        <div class="hero-actions">
          <a class="button primary" href="docs.html#quick-start">Run an example</a>
          <a class="button blue" href="docs.html#choose-example">Choose a baseline</a>
          <a class="button ghost" href="docs.html">Read the full docs</a>
        </div>
        <div class="stat-strip" aria-label="Repository statistics">
          <div class="stat"><strong>22</strong><span>Documented examples</span></div>
          <div class="stat"><strong>12</strong><span>Tauri v1</span></div>
          <div class="stat"><strong>10</strong><span>Tauri v2</span></div>
          <div class="stat"><strong>7</strong><span>Technology families</span></div>
        </div>
      </div>
      <div class="hero-art" aria-label="Junkpile project logo">
        <div class="logo-card"><img src="assets/schwwaaa-junkpile-logo.jpg" alt="Illustration of an overflowing desk labeled junkpile"></div>
        <span class="hero-stamp">Baseline first</span>
      </div>
    </div>
  </section>

  <section class="section-dark section">
    <div class="container">
      <p class="eyebrow">How to use the library</p>
      <h2 class="section-heading">One repository.<br>Three depths of entry.</h2>
      <div class="path-grid" style="margin-top:36px">
        <article class="card" style="color:var(--ink)"><div class="card-number">01</div><h3>Get running</h3><p>Pick the smallest matching example, install its local dependencies, and launch it without reading the entire architecture guide.</p><a class="card-link" href="docs.html#quick-start">Five-minute path →</a></article>
        <article class="card" style="color:var(--ink)"><div class="card-number" style="background:var(--signal-3)">02</div><h3>Understand the system</h3><p>Trace input, state, rendering, WebView behavior, Rust responsibilities, and Tauri v1/v2 configuration through diagrams and file maps.</p><a class="card-link" href="docs.html#architecture">Architecture path →</a></article>
        <article class="card" style="color:var(--ink)"><div class="card-number" style="background:var(--signal-2)">03</div><h3>Build something strange</h3><p>Keep a working baseline intact, branch it, change one layer at a time, and document the behavior that makes your new example unique.</p><a class="card-link" href="docs.html#extending">Extension path →</a></article>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="container">
      <div class="truth-card">
        <h2 class="section-heading" style="font-size:clamp(2rem,4vw,3.6rem)">Both generations are WebView-first.</h2>
        <p>The Tauri v2 folders are real v2 ports, but they do not become native Metal, Vulkan, DirectX, or <code>wgpu</code> renderers merely because they use Tauri v2. The graphics in every current example remain JavaScript/WebGL inside the operating system WebView.</p>
        <div class="truth-grid">
          <div class="truth-pane"><h3>Present today</h3><p><strong>HTML / JavaScript / p5.js / WebGL</strong><br>↓<br>Tauri WebView<br>↓<br>OS web rendering stack</p></div>
          <div class="truth-pane false"><h3>Not yet present</h3><p><strong>Rust wgpu renderer</strong><br>↓<br>Native Metal / Vulkan / DX12 surface</p></div>
        </div>
      </div>
    </div>
  </section>

  <section class="section-signal section">
    <div class="container">
      <p class="eyebrow">Shared architecture</p>
      <h2 class="section-heading">The layers stay visible.</h2>
      <p class="section-intro">The examples are deliberately small enough to trace from a physical control or HTML slider all the way to the final pixels.</p>
      <div style="margin-top:32px">{architecture_diagram()}</div>
    </div>
  </section>

  <section class="section" id="families">
    <div class="container">
      <p class="eyebrow">Technology families</p>
      <h2 class="section-heading">Choose the part you want to learn.</h2>
      <p class="section-intro">Each family isolates one graphics or input architecture. Single-window and two-window variants reveal the cost of adding a transport layer.</p>
      <div class="family-grid" style="margin-top:34px">{family_cards}</div>
    </div>
  </section>

  <section class="section-dark section">
    <div class="container">
      <p class="eyebrow">Window topology</p>
      <h2 class="section-heading">Direct state or transported state.</h2>
      <p class="section-intro">A single-window example is the simplest mental model. A two-window example adds an explicit relay so controls and output can live on different displays.</p>
      <div style="margin-top:34px;color:var(--ink)">{topology_diagrams()}</div>
    </div>
  </section>

  <section class="section" id="examples">
    <div class="container" data-example-filter>
      <p class="eyebrow">Complete database</p>
      <h2 class="section-heading">Find your baseline.</h2>
      <p class="section-intro">Filter all 22 projects by Tauri generation, rendering family, or window topology. Each project has its own local README with a file map, architecture diagram, run commands, extension notes, and troubleshooting.</p>
      {filter_panel()}
      <div class="no-results" data-example-no-results>No examples match those filters.</div>
      <div class="example-grid">{cards}</div>
      <div class="button-row"><a class="button primary" href="docs.html#example-catalog">Open the detailed catalog</a><a class="button" href="docs/examples.json">View examples.json</a></div>
    </div>
  </section>

  <section class="section-signal section-tight">
    <div class="container grid-2" style="align-items:center">
      <div><p class="eyebrow">Documentation ethos</p><h2 class="section-heading" style="font-size:clamp(2.4rem,5vw,4rem)">No mystery meat architecture.</h2></div>
      <div><p class="lede" style="margin-top:0">Every claim is separated by evidence level. “Static reviewed” means the source and configuration were inspected. It does not secretly mean every build, operating system, camera, controller, or network path has been runtime-tested.</p><a class="button dark" href="docs.html#validation">Read validation status</a></div>
    </div>
  </section>
</main>
{footer()}
</body>
</html>'''


def docs_nav() -> str:
    items = [
        ("orientation", "Orientation", False),
        ("quick-start", "Quick start", False),
        ("choose-example", "Choose an example", False),
        ("concepts", "Core concepts", False),
        ("architecture", "Architecture", False),
        ("topologies", "Window topologies", True),
        ("rendering-families", "Rendering families", False),
        ("native-inputs", "Native inputs", True),
        ("tauri-versions", "Tauri v1 vs v2", False),
        ("project-structure", "Project structure", False),
        ("example-catalog", "All 22 examples", False),
        ("development", "Development setup", False),
        ("troubleshooting", "Troubleshooting", False),
        ("extending", "Extending Junkpile", False),
        ("validation", "Validation status", False),
        ("glossary", "Glossary", False),
    ]
    return "".join(f'<a class="{"sub" if sub else ""}" href="#{id_}">{e(label)}</a>' for id_, label, sub in items)


def family_docs() -> str:
    blocks = []
    for key, info in FAMILY.items():
        if key == "midi" or key == "osc":
            continue
        if key == "feedback":
            diagram = '''<div class="diagram"><p class="diagram-title">Ping-pong feedback frame</p><div class="flow"><div class="flow-node"><strong>Previous texture A</strong></div><div class="flow-arrow">+</div><div class="flow-node orange"><strong>Webcam texture</strong></div><div class="flow-arrow">→</div><div class="flow-node signal"><strong>Simulation shader</strong></div><div class="flow-arrow">→</div><div class="flow-node blue"><strong>Next texture B</strong></div><div class="flow-arrow">→</div><div class="flow-node dark"><strong>Display + swap</strong></div></div></div>'''
        elif key == "webcam":
            diagram = '''<div class="diagram"><p class="diagram-title">Camera frame path</p><div class="flow"><div class="flow-node orange"><strong>OS camera</strong></div><div class="flow-arrow">→</div><div class="flow-node"><strong>getUserMedia</strong></div><div class="flow-arrow">→</div><div class="flow-node"><strong>hidden video</strong></div><div class="flow-arrow">→</div><div class="flow-node blue"><strong>texImage2D</strong></div><div class="flow-arrow">→</div><div class="flow-node dark"><strong>effect shader</strong></div></div></div>'''
        elif key == "glsl":
            diagram = '''<div class="diagram"><p class="diagram-title">External shader path</p><div class="flow"><div class="flow-node signal"><strong>shader.frag</strong></div><div class="flow-arrow">→</div><div class="flow-node"><strong>fetch / load text</strong></div><div class="flow-arrow">→</div><div class="flow-node blue"><strong>compile + link</strong></div><div class="flow-arrow">→</div><div class="flow-node dark"><strong>draw full-screen quad</strong></div></div></div>'''
        else:
            diagram = ""
        blocks.append(f'''
        <div class="family-detail" id="family-{key}">
          <span class="doc-kicker">{e(info['title'])} baseline</span>
          <h3>{e(info['short'])}</h3>
          <p>{e(info['description'])}</p>
          <div class="grid-2">
            <div class="callout info"><strong>What you learn</strong>{e(info['learn'])}</div>
            <div class="callout good"><strong>When to choose it</strong>{e(info['start'])}</div>
          </div>
          {diagram}
        </div>''')
    return "".join(blocks)


def troubleshooting_details() -> str:
    rows = [
        ("Wrong Tauri CLI generation", "Configuration schema errors or unknown fields", "Run npm install and npm run dev inside the example. The project-local CLI major must match its Rust dependencies and config schema."),
        ("WebSocket port already in use", "Two-window controls and canvas remain disconnected", "Only one current WS template can bind loopback port 2727. Stop the other template or change the Rust PORT constant and both frontend WS_URL values together."),
        ("Shader compilation failure", "Blank canvas with a compiler log", "Read the exact GLSL log. Check WebGL 1 / GLSL ES 1.0 syntax, precision, matching varyings, uniform names, compile-time loop constraints, and unsupported WebGL 2 features."),
        ("Blank p5.js canvas", "No visual output in a p5 example", "Confirm the p5 CDN request succeeded, CSP permits cdnjs, createCanvas(..., WEBGL) ran, and there are no JavaScript or shader errors."),
        ("Blank raw WebGL canvas", "Canvas exists but nothing draws", "Confirm getContext('webgl'), shader compile/link status, nonzero dimensions, gl.viewport, the quad buffer, the attribute location, and the final draw call."),
        ("Camera permission or device failure", "No devices, black frame, or rejected permission", "Check OS permission, refresh device labels after permission, close apps that may hold the camera, verify the video ready state, then inspect texture upload errors."),
        ("Feedback clears after resize", "Accumulated state disappears", "This is expected because framebuffer textures are recreated at new dimensions. Preserving state requires explicit resampling."),
        ("MIDI device missing", "Controller does not appear or connect", "Use the debug action to print the exact port names Rust sees. Check OS MIDI tools, virtual ports, device permissions, and exclusive access."),
        ("OSC packets do not move controls", "Sender appears configured but no parameters change", "UDP has no connection handshake. Verify host, port 9000, OSC address, argument type, firewall, and the on-screen packet log."),
    ]
    return "".join(f'<details><summary>{e(title)} — {e(symptom)}</summary><div class="details-body"><p>{e(fix)}</p></div></details>' for title, symptom, fix in rows)


def docs_page() -> str:
    detailed_cards = "".join(example_card(ex, detailed=True) for ex in EXAMPLES)
    return f'''{head("Junkpile documentation · Tauri graphics examples", "Comprehensive setup, architecture, diagrams, example catalog, and troubleshooting for the Junkpile Tauri graphics baseline library.")}
<body>
{header('docs')}
<main id="main" class="docs-shell">
  <aside class="docs-sidebar" aria-label="Documentation table of contents">
    <div class="docs-sidebar-head"><button class="docs-toc-toggle" data-docs-toc-toggle aria-expanded="false"><strong>Contents <span class="docs-toc-state" data-docs-toc-state>Open</span></strong><small>From first run to deep architecture</small></button></div>
    <nav>{docs_nav()}</nav>
  </aside>
  <div class="docs-main">
    <section class="docs-hero">
      <p class="eyebrow">Developer documentation</p>
      <h1>Run it.<br>Trace it.<br>Change it.</h1>
      <p class="lede">This page is organized in layers. The first sections get a new developer moving quickly. Later sections expose the transport, graphics, native-input, configuration, and validation details behind every example.</p>
      <div class="docs-search-wrap">
        <label class="search-field"><span aria-hidden="true">⌕</span><input data-doc-search type="search" placeholder="Search the documentation…" aria-label="Search documentation"></label>
        <div class="docs-search-status" data-doc-search-status>Search setup, architecture, inputs, examples, and troubleshooting.</div>
      </div>
    </section>
    <div class="no-results" data-doc-no-results>No documentation sections match that search. Try a broader term such as “camera,” “WebSocket,” “shader,” or “v2.”</div>

    <section class="doc-section" id="orientation" data-doc-section>
      <span class="doc-kicker">Layer 0 · Read this first</span>
      <h2>What Junkpile is <a class="anchor-link" href="#orientation">#</a></h2>
      <p>Junkpile is a developer library of small Tauri applications for live visual work. Each project isolates one rendering or input architecture so you can verify a known baseline, understand its data flow, and then build a specific idea without inheriting an undocumented prototype.</p>
      <div class="grid-3">
        <div class="card"><div class="card-number">A</div><h3>Baseline</h3><p>The smallest useful example of one architecture, kept readable and application-neutral.</p></div>
        <div class="card"><div class="card-number" style="background:var(--signal-3)">B</div><h3>Paired comparison</h3><p>Where possible, the same graphics concept exists in v1/v2 and single/two-window forms.</p></div>
        <div class="card"><div class="card-number" style="background:var(--signal-2)">C</div><h3>Unique example</h3><p>An artistic or product-specific branch created only after the baseline is accepted and preserved.</p></div>
      </div>
      <div class="callout warn"><strong>Important scope boundary</strong>Every current renderer runs inside the Tauri WebView. The repository does not yet contain a native Rust <code>wgpu</code>, Metal, Vulkan, or DirectX surface family.</div>
      <div class="status-meter"><div class="active">22 static reviewed</div><div>0 build verified here</div><div>0 runtime verified here</div><div>0 cross-platform verified</div></div>
    </section>

    <section class="doc-section" id="quick-start" data-doc-section>
      <span class="doc-kicker">Layer 1 · Fast path</span>
      <h2>Run an example <a class="anchor-link" href="#quick-start">#</a></h2>
      <ol class="number-list">
        <li><strong>Install the platform prerequisites.</strong> You need Rust through <code>rustup</code>, Node.js/npm, and the operating-system packages required by Tauri.</li>
        <li><strong>Choose one independent project.</strong> There is no root workspace command. Start with <code>v1/p5-tauri-single-template</code> for the shortest learning path.</li>
        <li><strong>Use the local npm scripts.</strong> This selects the correct Tauri CLI major declared by that project instead of an unrelated global CLI.</li>
        <li><strong>Confirm the baseline before editing.</strong> Verify the app launches and the main control/render path behaves as described.</li>
      </ol>
      <div class="code-shell">
        <div class="code-label"><span>terminal · first recommended example</span><button class="copy-button" data-copy="#quick-command">Copy</button></div>
        <pre id="quick-command"><code>cd v1/p5-tauri-single-template
npm install
npm run dev</code></pre>
      </div>
      <p>Build an installable application from the same project directory:</p>
      <div class="code-shell"><div class="code-label"><span>terminal</span><button class="copy-button" data-copy="#build-command">Copy</button></div><pre id="build-command"><code>npm run build</code></pre></div>
      <div class="callout info"><strong>Why not <code>cargo tauri dev</code> from anywhere?</strong>The examples deliberately pin v1 or v2 of <code>@tauri-apps/cli</code> in each local <code>package.json</code>. <code>npm run dev</code> is the most reliable way to keep the CLI, Cargo dependencies, and config schema aligned.</div>
    </section>

    <section class="doc-section" id="choose-example" data-doc-section data-layer-tabs>
      <span class="doc-kicker">Layer 1 · Decision guide</span>
      <h2>Choose the smallest matching baseline <a class="anchor-link" href="#choose-example">#</a></h2>
      <p>Do not begin with the most advanced example merely because it contains more features. Start with the fewest layers that prove your idea.</p>
      <div class="layer-tabs" role="tablist" aria-label="Example choice by developer goal">
        <button class="layer-tab is-active" data-layer-tab="fast" role="tab" aria-selected="true">I want pixels quickly</button>
        <button class="layer-tab" data-layer-tab="control" role="tab" aria-selected="false">I need external control</button>
        <button class="layer-tab" data-layer-tab="camera" role="tab" aria-selected="false">I need live video</button>
        <button class="layer-tab" data-layer-tab="deep" role="tab" aria-selected="false">I want the low-level path</button>
      </div>
      <div class="layer-panel is-active" data-layer-panel="fast"><div class="callout good"><strong>Start with p5 single-window.</strong> It has the shortest path from a parameter to a shader uniform and visual result. Move to the WS variant only when separate controls/output matter.</div></div>
      <div class="layer-panel" data-layer-panel="control"><div class="callout good"><strong>MIDI for hardware, OSC for network software, WebSocket for a second app window.</strong> MIDI and OSC currently exist only in the v1 set.</div></div>
      <div class="layer-panel" data-layer-panel="camera"><div class="callout good"><strong>Webcam first, feedback second.</strong> Confirm camera permission, video readiness, and texture upload in the webcam baseline before adding persistent framebuffer state.</div></div>
      <div class="layer-panel" data-layer-panel="deep"><div class="callout good"><strong>Raw WebGL or external GLSL.</strong> Raw WebGL exposes the complete browser GPU setup. External GLSL adds runtime file loading and a cleaner shader-authoring boundary.</div></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Goal</th><th>First choice</th><th>Move deeper when…</th></tr></thead>
          <tbody>
            <tr><td>Prototype a shader</td><td>p5 single</td><td>You need explicit graphics plumbing or shader file loading.</td></tr>
            <tr><td>Understand browser GPU setup</td><td>raw WebGL single</td><td>You need runtime-editable external shaders.</td></tr>
            <tr><td>Edit a separate shader file</td><td>GLSL single</td><td>You need controls on another display.</td></tr>
            <tr><td>Process live camera frames</td><td>webcam single</td><td>You need persistent trails or simulation state.</td></tr>
            <tr><td>Create recursive trails</td><td>feedback single</td><td>You need controls separated from output.</td></tr>
            <tr><td>Use a physical controller</td><td>MIDI v1</td><td>You need custom mappings, multiple devices, or a v2 port.</td></tr>
            <tr><td>Control from creative software</td><td>OSC v1</td><td>You need discovery, feedback messages, or multi-node networking.</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="doc-section" id="concepts" data-doc-section>
      <span class="doc-kicker">Layer 2 · Mental model</span>
      <h2>Six concepts explain most of the repository <a class="anchor-link" href="#concepts">#</a></h2>
      <div class="grid-3">
        <div class="card"><h3>WebView</h3><p>The embedded browser surface where HTML, JavaScript, p5.js, camera APIs, and WebGL run.</p></div>
        <div class="card"><h3>Rust host</h3><p>The native Tauri process. It creates the application and owns MIDI, OSC, or the local WebSocket relay when needed.</p></div>
        <div class="card"><h3>State</h3><p>The current parameter values. Single-window state is direct; two-window state is serialized and transported.</p></div>
        <div class="card"><h3>Render loop</h3><p>A repeated function that reads state, uploads uniforms or textures, and draws the next frame.</p></div>
        <div class="card"><h3>Shader</h3><p>GPU code that determines how vertices or pixels are produced. Current examples use WebGL-era GLSL.</p></div>
        <div class="card"><h3>Baseline evidence</h3><p>A source review, successful build, runtime test, or cross-platform test are different levels of confidence.</p></div>
      </div>
    </section>

    <section class="doc-section" id="architecture" data-doc-section>
      <span class="doc-kicker">Layer 2 · Shared system</span>
      <h2>Repository architecture <a class="anchor-link" href="#architecture">#</a></h2>
      <p>The WebView owns the visual pipeline in every current project. Rust participates where native APIs or cross-window transport are required, but JavaScript still owns the live graphics loop.</p>
      {architecture_diagram()}
      <h3 id="topologies">Single-window and two-window topologies</h3>
      {topology_diagrams()}
      <div class="callout warn"><strong>Port behavior</strong>All two-window examples currently use loopback TCP port <code>2727</code>. Running two WS templates at the same time creates a bind conflict unless the Rust constant and both JavaScript URLs are changed together.</div>
    </section>

    <section class="doc-section" id="rendering-families" data-doc-section>
      <span class="doc-kicker">Layer 3 · Graphics</span>
      <h2>Rendering families <a class="anchor-link" href="#rendering-families">#</a></h2>
      <p>Each family teaches a different amount of graphics plumbing. The final pixels may look related, but the code boundaries are intentionally different.</p>
      {family_docs()}
    </section>

    <section class="doc-section" id="native-inputs" data-doc-section>
      <span class="doc-kicker">Layer 3 · Hardware and network inputs</span>
      <h2>Native input bridges <a class="anchor-link" href="#native-inputs">#</a></h2>
      <div class="family-detail" id="family-midi">
        <h3>MIDI: hardware bytes become structured frontend events</h3>
        <p>Rust uses <code>midir</code> because Web MIDI support inside desktop WebViews is inconsistent. Rust owns port enumeration, connection state, and message callbacks. JavaScript maps the resulting events to visual parameters.</p>
        <div class="diagram"><p class="diagram-title">MIDI path</p><div class="flow"><div class="flow-node signal"><strong>Controller</strong><small>CC · note · pitch bend</small></div><div class="flow-arrow">→</div><div class="flow-node orange"><strong>midir in Rust</strong><small>native port + callback</small></div><div class="flow-arrow">→</div><div class="flow-node blue"><strong>Tauri event</strong><small>structured message</small></div><div class="flow-arrow">→</div><div class="flow-node dark"><strong>p5 uniforms</strong><small>next frame</small></div></div></div>
        <p><strong>Current gap:</strong> there is no Tauri v2 MIDI baseline yet. A trustworthy port should document v2 commands/events, capabilities, permissions, and platform testing.</p>
      </div>
      <div class="family-detail" id="family-osc">
        <h3>OSC: UDP packets become creative parameter messages</h3>
        <p>Rust binds UDP port <code>9000</code> through Tokio, decodes packets with <code>rosc</code>, and emits messages into JavaScript. Creative address mapping remains in the frontend so it can change without rebuilding Rust.</p>
        <div class="diagram"><p class="diagram-title">OSC path</p><div class="flow"><div class="flow-node signal"><strong>TouchOSC / Max / PD</strong></div><div class="flow-arrow">→</div><div class="flow-node orange"><strong>UDP :9000</strong></div><div class="flow-arrow">→</div><div class="flow-node"><strong>rosc decode</strong></div><div class="flow-arrow">→</div><div class="flow-node blue"><strong>Tauri event</strong></div><div class="flow-arrow">→</div><div class="flow-node dark"><strong>JS address map</strong></div></div></div>
        <p><strong>Current gap:</strong> there is no Tauri v2 OSC baseline yet.</p>
      </div>
    </section>

    <section class="doc-section" id="tauri-versions" data-doc-section>
      <span class="doc-kicker">Layer 3 · Framework generations</span>
      <h2>Tauri v1 and v2 in this repository <a class="anchor-link" href="#tauri-versions">#</a></h2>
      <p>The paired projects intentionally preserve their JavaScript graphics architecture. That keeps the framework migration visible instead of changing Tauri, rendering technology, controls, and visual behavior simultaneously.</p>
      <div class="table-wrap"><table class="compare-table">
        <thead><tr><th>Concern</th><th>Tauri v1</th><th>Tauri v2</th></tr></thead>
        <tbody>
          <tr><td>Config schema</td><td><code>config/1</code></td><td><code>config/2</code></td></tr>
          <tr><td>Product metadata</td><td><code>package</code> object</td><td>Top-level fields</td></tr>
          <tr><td>Window/security config</td><td><code>tauri</code> object</td><td><code>app</code> object</td></tr>
          <tr><td>Static frontend path</td><td><code>devPath</code> + <code>distDir</code></td><td><code>frontendDist</code></td></tr>
          <tr><td>Rust dependency</td><td><code>tauri = "1"</code></td><td><code>tauri = "2"</code></td></tr>
          <tr><td>Graphics path here</td><td>WebView / WebGL</td><td>WebView / WebGL</td></tr>
          <tr><td>Automatically native GPU?</td><td>No</td><td>No</td></tr>
        </tbody>
      </table></div>
      <details open><summary>Migration checklist for a new pair</summary><div class="details-body"><ul class="check-list"><li>Pin the correct local <code>@tauri-apps/cli</code> major.</li><li>Pin matching <code>tauri</code> and <code>tauri-build</code> majors.</li><li>Convert <code>tauri.conf.json</code> to the target schema.</li><li>Verify product name, identifier, windows, CSP, and icons.</li><li>Verify every configured window URL exists.</li><li>Verify commands/events against the target generation.</li><li>Run both development and release builds.</li><li>Test permissions and lifecycle behavior on each target OS.</li><li>Document only differences that are actually present.</li></ul></div></details>
    </section>

    <section class="doc-section" id="project-structure" data-doc-section>
      <span class="doc-kicker">Layer 3 · Files</span>
      <h2>How an example is organized <a class="anchor-link" href="#project-structure">#</a></h2>
      <div class="code-shell"><div class="code-label"><span>representative project tree</span></div><pre><code>example/
├── package.json              # local Tauri CLI and npm scripts
├── README.md                 # purpose, setup, architecture, extension notes
├── src/
│   ├── index.html            # or controls.html + canvas.html
│   ├── sketch.js             # or controls.js + canvas.js
│   └── shader.frag           # external GLSL family only
└── src-tauri/
    ├── Cargo.toml            # Rust package and native dependencies
    ├── build.rs
    ├── tauri.conf.json       # generation-specific app/window config
    └── src/main.rs           # Tauri host, relay, MIDI, or OSC bridge</code></pre></div>
      <div class="grid-2"><div class="callout info"><strong>Frontend responsibility</strong>Controls, application state, camera capture, render loop, WebGL resources, shaders, and visual behavior.</div><div class="callout info"><strong>Rust responsibility</strong>Application startup, native integrations, native async tasks, and the embedded relay used by two-window templates.</div></div>
    </section>

    <section class="doc-section" id="example-catalog" data-doc-section data-example-filter>
      <span class="doc-kicker">Layer 4 · Complete reference</span>
      <h2>All 22 examples <a class="anchor-link" href="#example-catalog">#</a></h2>
      <p>Every card links to the local project README and folder. Expand a card to see the exact run command, runtime flow, native dependencies, and fixed ports.</p>
      {filter_panel()}
      <button class="button" data-open-all="#example-catalog">Expand all</button>
      <div class="no-results" data-example-no-results>No examples match those filters.</div>
      <div class="example-grid" style="margin-top:22px">{detailed_cards}</div>
    </section>

    <section class="doc-section" id="development" data-doc-section>
      <span class="doc-kicker">Layer 4 · Environment and platforms</span>
      <h2>Development setup <a class="anchor-link" href="#development">#</a></h2>
      <h3>Core prerequisites</h3>
      <ul class="check-list"><li>Rust installed through <code>rustup</code>.</li><li>Node.js and npm.</li><li>macOS: Xcode command-line tools.</li><li>Windows: Microsoft C++ build tools and WebView2.</li><li>Linux: WebKitGTK and distribution-specific Tauri development packages.</li></ul>
      <h3>Camera validation</h3>
      <p>A camera example crosses six layers: device availability, WebView permission request, user permission, <code>getUserMedia()</code>, video readiness, and WebGL texture upload. Test them separately; a black image is not automatically a shader failure.</p>
      <h3>MIDI and OSC notes</h3>
      <div class="grid-2"><div class="card"><h4>MIDI</h4><p>Verify hardware in the OS MIDI utility. On macOS, the IAC Driver provides virtual routing. Linux builds may require ALSA development packages and device permissions.</p></div><div class="card"><h4>OSC</h4><p>Point the sender at the computer running Junkpile and UDP port <code>9000</code>. Firewalls, address spelling, and argument types are common failure points.</p></div></div>
      <h3>Offline p5.js</h3>
      <p>Several p5-family examples currently load p5.js from cdnjs. To make one self-contained, vendor a known p5.js file into <code>src/vendor</code>, update the script path, tighten the CSP, and record the vendored version/license.</p>
      <h3>Platform test record</h3>
      <div class="code-shell"><div class="code-label"><span>copy into a test report</span><button class="copy-button" data-copy="#platform-record">Copy</button></div><pre id="platform-record"><code>OS and version:
CPU architecture:
Rust version:
Node/npm version:
Tauri CLI version:
Development launch: pass/fail
Release build: pass/fail
Core input path: pass/fail
Known warnings:
Screenshot filename:</code></pre></div>
    </section>

    <section class="doc-section" id="troubleshooting" data-doc-section>
      <span class="doc-kicker">Layer 4 · Failure diagnosis</span>
      <h2>Troubleshooting by layer <a class="anchor-link" href="#troubleshooting">#</a></h2>
      <p>Start with the earliest layer that could fail. Do not rewrite shaders before confirming that the app, window, external script, media permission, or network listener actually started.</p>
      <button class="button" data-open-all="#troubleshooting">Expand all</button>
      <div style="margin-top:18px">{troubleshooting_details()}</div>
    </section>

    <section class="doc-section" id="extending" data-doc-section>
      <span class="doc-kicker">Layer 5 · Create new work</span>
      <h2>Extend without destroying the baseline <a class="anchor-link" href="#extending">#</a></h2>
      <ol class="number-list"><li><strong>Choose the nearest accepted baseline.</strong> Do not merge unrelated systems before each one works independently.</li><li><strong>Preserve it.</strong> Keep a clean commit, tag, or branch that remains a neutral reference.</li><li><strong>Change one architectural layer.</strong> Add a shader, input method, transport behavior, or native integration—not all four at once.</li><li><strong>Comment the reason.</strong> Explain boundaries, lifecycle constraints, platform behavior, and non-obvious tradeoffs rather than narrating syntax.</li><li><strong>Document the new behavior.</strong> Include purpose, prerequisites, architecture, file map, run/build steps, controls, extension points, troubleshooting, and validation evidence.</li></ol>
      <h3>Good next baseline families</h3>
      <div class="grid-3"><div class="card"><h4>WebGPU in WebView</h4><p>Modern browser GPU APIs while retaining an HTML surface.</p></div><div class="card"><h4>Native wgpu</h4><p>A genuinely separate Rust GPU surface family with explicit resize and overlay strategy.</p></div><div class="card"><h4>Texture sharing</h4><p>Syphon on macOS and Spout on Windows.</p></div><div class="card"><h4>Audio analysis</h4><p>FFT, onset, envelope, and audio-reactive parameter paths.</p></div><div class="card"><h4>Video timeline</h4><p>File decode, seek, loop, synchronization, and export behavior.</p></div><div class="card"><h4>Other hardware</h4><p>Gamepad, HID, serial/Arduino, screen capture, NDI, or depth cameras.</p></div></div>
    </section>

    <section class="doc-section" id="validation" data-doc-section>
      <span class="doc-kicker">Layer 5 · Evidence and transparency</span>
      <h2>What has—and has not—been verified <a class="anchor-link" href="#validation">#</a></h2>
      <p>The repository audit checked structure and source consistency. That is valuable, but it is not equivalent to compiling or running every project.</p>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Status</th><th>Meaning</th><th>Current repository</th></tr></thead><tbody>
        <tr><td>Static reviewed</td><td>Source, config, references, and JavaScript syntax inspected.</td><td>All 22 examples</td></tr>
        <tr><td>Build verified</td><td><code>npm run build</code> completed on a named platform.</td><td>Not performed in the documentation environment</td></tr>
        <tr><td>Runtime verified</td><td>App launched and its central input/render path worked.</td><td>Not performed in the documentation environment</td></tr>
        <tr><td>Cross-platform verified</td><td>Runtime verified on macOS, Windows, and Linux.</td><td>Not yet established</td></tr>
      </tbody></table></div>
      <div class="callout danger"><strong>Do not translate “looks complete” into “stable.”</strong>Camera permissions, MIDI devices, OSC traffic, graphics-driver behavior, packaging, signing, WebView differences, and release bundles require named runtime tests.</div>
      <p>Run <code>python3 scripts/audit_examples.py</code> after structural changes. Run <code>python3 scripts/build_site.py</code> after changing <code>docs/examples.json</code> so this web catalog stays aligned.</p>
    </section>

    <section class="doc-section" id="glossary" data-doc-section>
      <span class="doc-kicker">Reference</span>
      <h2>Glossary for new developers <a class="anchor-link" href="#glossary">#</a></h2>
      <dl class="glossary-grid">
        <div class="glossary-item"><dt>Baseline</dt><dd>A minimal, neutral example that proves one architecture before product-specific behavior is added.</dd></div>
        <div class="glossary-item"><dt>Tauri</dt><dd>A Rust-based desktop application framework that hosts web frontend content inside an OS WebView.</dd></div>
        <div class="glossary-item"><dt>WebView</dt><dd>The embedded browser engine used to render HTML/CSS/JavaScript in a desktop window.</dd></div>
        <div class="glossary-item"><dt>WebGL</dt><dd>A browser API for GPU graphics. Current examples use a WebGL 1 style pipeline.</dd></div>
        <div class="glossary-item"><dt>GLSL</dt><dd>The shader language used by the current WebGL examples.</dd></div>
        <div class="glossary-item"><dt>Shader</dt><dd>A small GPU program. Fragment shaders determine pixel color; vertex shaders transform geometry.</dd></div>
        <div class="glossary-item"><dt>Uniform</dt><dd>A value uploaded from JavaScript that remains constant during one draw call, such as time, hue, or intensity.</dd></div>
        <div class="glossary-item"><dt>Texture</dt><dd>Image-like data stored on the GPU, including webcam frames and feedback state.</dd></div>
        <div class="glossary-item"><dt>Framebuffer</dt><dd>An off-screen GPU render target. Ping-pong feedback alternates between two of them.</dd></div>
        <div class="glossary-item"><dt>IPC / event bridge</dt><dd>Communication between frontend JavaScript and the Rust host process.</dd></div>
        <div class="glossary-item"><dt>WebSocket</dt><dd>A persistent message transport. Junkpile uses a loopback relay for controls-to-canvas communication.</dd></div>
        <div class="glossary-item"><dt>OSC</dt><dd>Open Sound Control, a network message format widely used by creative software.</dd></div>
        <div class="glossary-item"><dt>MIDI</dt><dd>A hardware/software control protocol using notes, continuous controllers, pitch bend, and other messages.</dd></div>
        <div class="glossary-item"><dt>CSP</dt><dd>Content Security Policy, which controls what scripts, assets, and network connections a WebView may use.</dd></div>
      </dl>
    </section>
  </div>
</main>
{footer()}
</body>
</html>'''


(ROOT / "index.html").write_text(index_page(), encoding="utf-8")
(ROOT / "docs.html").write_text(docs_page(), encoding="utf-8")
print(f"Built index.html and docs.html from {len(EXAMPLES)} examples")
