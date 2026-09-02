#!/usr/bin/env python3
"""Build Junkpile's static overview and technical documentation.

The generator reads docs/examples.json, which is derived from the repository tree.
Public copy deliberately avoids fixed example totals so adding a project does not
require marketing-copy maintenance.
"""
from __future__ import annotations
import html, json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / 'docs' / 'examples.json').read_text())
EXAMPLES = DATA['examples']

TRACKS = {
    'v1': ('Tauri v1', 'WebView', 'WebGL / GLSL'),
    'v2': ('Tauri v2', 'WebView', 'WebGL / GLSL'),
    'wgpu': ('Native wgpu', 'Native GPU', 'Rust / WGSL'),
}

STATUS_LABELS = {
    'documented-current':'Current',
    'working-baseline':'Working baseline',
    'unresolved-under-review':'Unresolved',
    'macos-specific':'macOS',
    'windows-specific':'Windows',
    'ndi-sdk-required':'NDI SDK',
}

def e(v): return html.escape(str(v), quote=True)

def head(title, description):
    return f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="{e(description)}" />
  <meta name="theme-color" content="#07080B" />
  <title>{e(title)}</title>
  <link href="assets/icons/favicon-32x32.png" rel="icon" sizes="32x32" />
  <link href="assets/site/site.css" rel="stylesheet" />
  <script defer src="assets/site/site.js"></script>
</head>'''

def header(current=''):
    def link(href,label,key):
        cur=' aria-current="page"' if current==key else ''
        return f'<a href="{href}" data-primary-nav="{key}"{cur}>{label}</a>'
    return f'''<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header">
  <div class="header-inner">
    <a class="brand" href="index.html"><img alt="" aria-hidden="true" class="brand-symbol" src="assets/brand/junkpile-amorphous-icon.png" /><span>junkpile<small>creative graphics systems</small></span></a>
    <button aria-controls="site-nav" aria-expanded="false" class="nav-toggle" data-nav-toggle>Menu</button>
    <nav aria-label="Primary navigation" class="site-nav" data-site-nav id="site-nav">
      {link('index.html','Overview','overview')}
      {link('docs.html','Documentation','docs')}
      {link('docs.html#installation-build','Install','install')}
      {link('docs.html#example-catalog','Examples','examples')}
      <a href="https://github.com/schwwaaa/junkpile">GitHub</a>
    </nav>
  </div>
</header>'''

def footer():
    return '''<footer class="schwwaaa-footer" aria-label="schwwaaa footer logo">
  <a class="schwwaaa-footer-logo" href="https://linktr.ee/schwwaaa" target="_blank" rel="noopener noreferrer">
    <img class="schwwaaa-footer-image" src="./assets/schwwaaa-logo.png" alt="schwwaaa" />
  </a>
</footer>'''

def footer_css():
    return '''<style>
.schwwaaa-footer{position:relative;z-index:1;width:100%;padding:28px 0 36px;text-align:center}.schwwaaa-footer-logo{display:inline-flex;align-items:center;justify-content:center;text-decoration:none}.schwwaaa-footer-image{display:block;width:min(168px,44vw);height:auto;object-fit:contain;opacity:.9;filter:drop-shadow(0 0 12px rgba(255,255,255,.22)) drop-shadow(0 0 22px rgba(13,110,253,.18));transition:opacity .3s ease,transform .3s ease,filter .3s ease}.schwwaaa-footer-logo:hover .schwwaaa-footer-image{opacity:1;transform:translateY(-1px);filter:drop-shadow(0 0 14px rgba(255,255,255,.35)) drop-shadow(0 0 28px rgba(13,110,253,.32))}
</style>'''

def card(ex, detailed=False):
    track=TRACKS[ex['collection']][0]
    status=STATUS_LABELS.get(ex.get('status',''),'Current')
    status_class='danger' if ex.get('status')=='unresolved-under-review' else 'status'
    platforms=' · '.join(ex.get('platforms',[]))
    details=''
    if detailed:
        val=''
        if ex.get('validation_document'):
            val=f'<a class="mini-button" href="{e(ex["validation_document"])}">Validation</a>'
        details=f'''<details><summary>Project details</summary><div class="details-body">
          <p><strong>Summary:</strong> {e(ex['summary'])}</p>
          <p><strong>Topology:</strong> <code>{e(ex['topology'])}</code></p>
          <p><strong>Platforms:</strong> {e(platforms)}</p>
          <div class="code-shell"><div class="code-label">Development</div><pre><code>cd {e(ex['path'])}
npm install
npm run dev</code></pre></div>
          <div class="example-actions">{val}</div>
        </div></details>'''
    return f'''<article class="example-card" data-example-card data-version="{e(ex['collection'])}" data-family="{e(ex['family'])}">
      <div class="example-card-head"><span class="badge">{e(track)} {e(ex['number'])}</span><span class="card-tag {status_class}">{e(status)}</span></div>
      <div class="example-card-body">
        <h3>{e(ex['title'])}</h3><code>{e(ex['id'])}</code>
        <p>{e(ex['summary'])}</p>
        <div class="example-meta"><span>{e(ex['family'])}</span><span>{e(ex['topology'])}</span></div>
        {details}
        <div class="example-actions"><a class="mini-button" href="{e(ex['documentation'])}">Local README</a><a class="mini-button" href="{e(ex['path'])}/">Project folder</a></div>
      </div>
    </article>'''

def catalog(detailed=True):
    return ''.join(card(x,detailed) for x in EXAMPLES)

def representative(ids):
    found={x['id']:x for x in EXAMPLES}
    return ''.join(card(found[i],False) for i in ids if i in found)

def index_page():
    reps=representative([
        '00-p5-tauri-single-template','12-tauri-v2-video-texture-player',
        '20-wgpu-multi-input-compositor','30-wgpu-high-resolution-record',
        '39-wgpu-cross-platform-output-router','43-wgpu-av-recorder',
        '44-wgpu-wgsl-shader-playground'])
    return f'''{head('Junkpile · Creative graphics systems laboratory','Standalone Tauri and native wgpu projects for creative graphics, media, recording, routing, and GPU application development.')}
{footer_css()}
<body>
{header('overview')}
<main id="main">
<section class="hero"><div class="container hero-grid"><div class="hero-title">
  <p class="eyebrow">Coding templates for live visual art</p>
  <div class="hero-brand-lockup"><img class="hero-brand-mark" alt="Junkpile amorphous shader-form logo" src="assets/brand/junkpile-amorphous-icon.png" /><h1 class="hero-brand-name">junkpile</h1></div>
</div><div class="hero-copy">
  <p class="lede">Junkpile is a laboratory of standalone creative-graphics applications. WebView and native GPU paths are documented side by side so you can start with the simplest useful architecture and move lower-level only when the application actually benefits from it.</p>
  <div class="hero-actions"><a class="button primary" href="docs.html#installation-build">Install &amp; run</a><a class="button blue" href="docs.html#example-catalog">Browse examples</a><a class="button ghost" href="docs.html#architecture">Understand the architecture</a></div>
</div><div aria-label="Core technical paths" class="stat-strip"><div class="stat"><strong>WebView</strong><span>p5.js · WebGL · GLSL</span></div><div class="stat"><strong>Desktop</strong><span>Tauri v1 · Tauri v2</span></div><div class="stat"><strong>Native GPU</strong><span>Rust · wgpu · WGSL</span></div><div class="stat"><strong>Media I/O</strong><span>capture · record · route · share</span></div></div></div></section>

<section class="section-dark section"><div class="container"><p class="eyebrow">Three repository tracks</p><h2 class="section-heading">Similar goals. Different render ownership.</h2><p class="section-intro">Tauri generation, renderer choice, and media I/O are separate decisions. The current repository organizes examples as Tauri v1 WebView, Tauri v2 WebView, and Tauri 2 + native wgpu, but native transports are not inherently exclusive to the wgpu renderer.</p><div class="path-grid" style="margin-top:36px">
<article class="card"><div class="card-number">V1</div><h3>Tauri v1 WebView</h3><p>HTML, JavaScript, p5.js, raw WebGL, GLSL, browser media, and Rust bridges using the first-generation Tauri configuration model.</p><a class="card-link" href="docs.html#v1-track">Explore v1 →</a></article>
<article class="card"><div class="card-number">V2</div><h3>Tauri v2 WebView</h3><p>The accessible browser graphics path with current Tauri capabilities, file workflows, window APIs, and standalone application patterns.</p><a class="card-link" href="docs.html#v2-track">Explore v2 →</a></article>
<article class="card"><div class="card-number">GPU</div><h3>Native Rust/wgpu</h3><p>WGSL, compute, explicit GPU resources, native media paths, high-resolution render/record, and the repository's current dedicated NDI, Syphon, Spout, and output-routing examples.</p><a class="card-link" href="docs.html#wgpu-track">Explore wgpu →</a></article>
</div></div></section>

<section class="section"><div class="container"><div class="truth-card"><p class="eyebrow">Architectural truth</p><h2 class="section-heading">Framework, renderer, and I/O are separate concerns.</h2><div class="truth-grid"><div class="truth-pane"><h3>Rendering path</h3><p><strong>WebView / WebGL</strong> or <strong>Rust / wgpu</strong><br/>determines who owns the pixels and GPU resources.</p></div><div class="truth-pane"><h3>Native services / I/O</h3><p><strong>files · MIDI · OSC · FFmpeg · NDI · Syphon · Spout</strong><br/>are application integrations whose bridge depends on the renderer and platform.</p></div></div><p>Tauri generation selects the desktop application framework and brings its own window/API constraints. Renderer ownership is a separate implementation decision, while external output transports are another layer again. An output transport should not be described as wgpu-only simply because Junkpile's current dedicated sender example uses wgpu.</p></div></div></section>

<section class="section-signal section"><div class="container"><p class="eyebrow">Application stack</p><h2 class="section-heading">From pixels to complete media tools.</h2><div class="diagram"><p class="diagram-title">Junkpile development layers</p><div class="flow"><div class="flow-node signal"><strong>Foundations</strong><small>surface · shader · controls</small></div><div class="flow-arrow">→</div><div class="flow-node"><strong>Media</strong><small>image · camera · video · audio</small></div><div class="flow-arrow">→</div><div class="flow-node blue"><strong>Processing</strong><small>feedback · compute · compositing</small></div><div class="flow-arrow">→</div><div class="flow-node orange"><strong>I/O</strong><small>record · NDI · Syphon · Spout</small></div><div class="flow-arrow">→</div><div class="flow-node dark"><strong>Applications</strong><small>focused standalone creative tools</small></div></div></div></div></section>

<section class="section"><div class="container"><p class="eyebrow">Current wgpu I/O references</p><h2 class="section-heading">One authoritative frame. Independent outputs.</h2><p class="section-intro">The newer wgpu series demonstrates one explicit output-contract architecture for recording and external sharing. This is the current Junkpile reference implementation, not a claim that FFmpeg, NDI, Syphon, or Spout require wgpu.</p><div class="diagram" style="margin-top:30px"><div class="flow"><div class="flow-node signal"><strong>Native renderer</strong><small>authoritative GPU texture</small></div><div class="flow-arrow">→</div><div class="flow-node"><strong>Frame/output contract</strong><small>cadence · dimensions · timestamps</small></div><div class="flow-arrow">→</div><div class="flow-node blue"><strong>Bounded sinks</strong><small>preview · record · NDI · share</small></div><div class="flow-arrow">→</div><div class="flow-node orange"><strong>Diagnostics</strong><small>drops · pressure · errors</small></div></div></div><div class="hero-actions"><a class="button blue" href="docs.html#native-io">I/O architecture</a><a class="button ghost" href="docs.html#av-recorder">A/V recorder</a></div></div></section>

<section class="section-dark section"><div class="container"><p class="eyebrow">Representative examples</p><h2 class="section-heading">The library is now an application laboratory.</h2><p class="section-intro">These projects show the span from an approachable p5.js baseline through media playback, native compositing, high-resolution recording, multi-output routing, A/V capture, and live WGSL tooling.</p><div class="example-grid" style="margin-top:30px">{reps}</div><div class="hero-actions"><a class="button primary" href="docs.html#example-catalog">Open the searchable catalog</a></div></div></section>

<section class="section"><div class="container"><p class="eyebrow">Working method</p><h2 class="section-heading">Preserve the baseline. Change one boundary.</h2><div class="principle-grid"><article class="card"><h3>Run first</h3><p>Prove the untouched example before debugging your modification.</p></article><article class="card"><h3>Keep ownership visible</h3><p>Know whether JavaScript, Rust, the GPU, or an external worker owns the failing state.</p></article><article class="card"><h3>Bound external work</h3><p>Recording and network/media workers should expose pressure rather than silently block the renderer.</p></article><article class="card"><h3>Document evidence</h3><p>Source presence, static review, runtime validation, and cross-platform verification are different claims.</p></article></div></div></section>
</main>
{footer()}
</body></html>'''

def docs_nav():
    items=[('orientation','Orientation',False),('quick-start','Quick start',False),('installation-build','Installation & build',False),('choose-track','Choose a track',False),('technical-comparison','Technical comparison',False),('software-stack','Software stack',False),('architecture','Architecture',False),('v1-track','Tauri v1',True),('v2-track','Tauri v2',True),('wgpu-track','Native wgpu',True),('native-io','I/O architecture',False),('av-recorder','A/V recorder',True),('output-routing','Output routing',True),('validation','Status & validation',False),('example-catalog','Example catalog',False),('development','Development',False),('troubleshooting','Troubleshooting',False),('glossary','Glossary',False)]
    return ''.join(f'<a class="{"sub" if sub else ""}" href="#{id_}">{label}</a>' for id_,label,sub in items)

def docs_page():
    allcards=catalog(True)
    return f'''{head('Junkpile technical documentation','Technical documentation for Junkpile WebView and native wgpu creative-application examples.')}
{footer_css()}
<body>
{header('docs')}
<main class="docs-shell" id="main">
<aside class="docs-sidebar"><div class="docs-sidebar-head"><button data-docs-toc-toggle aria-expanded="true"><strong>Documentation</strong><small data-docs-toc-state>Close</small></button></div><nav>{docs_nav()}</nav></aside>
<div class="docs-main">
<section class="docs-hero"><p class="eyebrow">Junkpile technical reference</p><h1>Choose the renderer.<br/>Attach the services you need.</h1><p class="lede">The documentation follows the actual repository while keeping three decisions separate: Tauri generation, pixel/render ownership, and native media/I/O integration.</p><div class="hero-actions"><a class="button primary" href="#installation-build">Install &amp; run</a><a class="button blue" href="#example-catalog">Examples</a><a class="button ghost" href="#native-io">I/O architecture</a></div><div class="docs-search-wrap"><label class="search-field"><span>⌕</span><input data-doc-search type="search" placeholder="Search documentation…" aria-label="Search documentation" /></label><div class="docs-search-status">Search hides sections that do not match.</div></div></section>

<section class="doc-section" id="orientation" data-doc-section><span class="doc-kicker">Orientation</span><h2>What Junkpile is <a class="anchor-link" href="#orientation">#</a></h2><p>Junkpile is a growing set of standalone desktop projects for creative graphics, live media, native GPU work, recording, routing, automation, and reusable application architecture.</p><div class="grid-3"><div class="card"><h3>Tauri generation</h3><p>v1 and v2 determine framework configuration, permissions, plugins, window APIs, IPC conventions, and some window-integration constraints.</p></div><div class="card"><h3>Render ownership</h3><p>In the current collections, WebView/WebGL or Tauri 2 + native Rust/wgpu determines who owns the pixels, textures, render loop, and GPU resources.</p></div><div class="card"><h3>Media + I/O</h3><p>Camera, audio, files, MIDI, OSC, FFmpeg, NDI, Syphon, Spout, and other transports are integrations layered onto an application architecture; they are not synonymous with one renderer.</p></div></div><div class="callout info"><strong>No fixed public total.</strong>The library is designed to grow. Documentation is organized around architectural tracks and capabilities rather than an advertised example count.</div></section>

<section class="doc-section" id="quick-start" data-doc-section><span class="doc-kicker">Quick start</span><h2>Run one project first <a class="anchor-link" href="#quick-start">#</a></h2><ol class="number-list"><li>Choose the smallest example that already owns the input/render/output boundary you need.</li><li>Enter that project directory.</li><li>Run <code>npm install</code> once for the project.</li><li>Run <code>npm run dev</code>.</li><li>Confirm the untouched baseline before editing.</li></ol><div class="code-shell"><div class="code-label">Example: Native A/V recorder</div><pre><code>git clone https://github.com/schwwaaa/junkpile.git
cd junkpile/wgpu/43-wgpu-av-recorder
npm install
npm run dev</code></pre></div></section>

<section class="doc-section" id="installation-build" data-doc-section><span class="doc-kicker">Installation &amp; build</span><h2>Install, run, and package a project <a class="anchor-link" href="#installation-build">#</a></h2><h3>Core tools</h3><div class="code-shell"><pre><code>git --version
node --version
npm --version
rustc --version
cargo --version</code></pre></div><h3>macOS</h3><div class="code-shell"><pre><code>xcode-select --install</code></pre></div><p>Native wgpu uses Metal. Camera/microphone projects require OS permissions. Syphon is macOS-specific.</p><h3>Windows</h3><p>Install Visual Studio Build Tools with Desktop development with C++, WebView2, and current GPU drivers. Spout projects have additional native build/runtime requirements.</p><h3>Linux</h3><p>Install the distribution's Tauri/WebKitGTK development packages and a functional Vulkan or supported GPU driver stack.</p><h3>Build</h3><div class="code-shell"><pre><code>cd &lt;project-folder&gt;
npm install
npm run build</code></pre></div><p>Typical bundles appear beneath <code>src-tauri/target/release/bundle/</code>. Signing/notarization requirements depend on platform and distribution method.</p><div class="callout warn"><strong>FFmpeg projects</strong>Native video decode/recording projects may require <code>ffmpeg</code> and <code>ffprobe</code>. NDI-enabled builds require the NDI SDK/runtime.</div></section>

<section class="doc-section" id="choose-track" data-doc-section><span class="doc-kicker">Choose a track</span><h2>Choose by ownership, then add I/O <a class="anchor-link" href="#choose-track">#</a></h2><div class="table-wrap"><table class="compare-table"><thead><tr><th>Need</th><th>Current Junkpile starting point</th></tr></thead><tbody><tr><td>p5.js / browser-media experimentation</td><td>Tauri v1 or v2 WebView</td></tr><tr><td>Current Tauri permissions, dialogs, window APIs</td><td>Tauri v2 WebView</td></tr><tr><td>Explicit GPU resources / compute</td><td>Native wgpu</td></tr><tr><td>Current high-resolution native render/record references</td><td>Native wgpu series</td></tr><tr><td>Current dedicated NDI / Syphon / Spout sender references</td><td>Native wgpu I/O series; the transports themselves are not wgpu-only</td></tr><tr><td>Fast creative application parity</td><td>Compare the WebView example with its native counterpart where one exists</td></tr></tbody></table></div></section>

<section class="doc-section" id="technical-comparison" data-doc-section><span class="doc-kicker">Technical comparison</span><h2>Implementation-level differences <a class="anchor-link" href="#technical-comparison">#</a></h2><div class="table-wrap"><table class="compare-table"><thead><tr><th>Concern</th><th>Tauri v1 WebView</th><th>Tauri v2 WebView</th><th>Tauri 2 + native wgpu</th></tr></thead><tbody><tr><td>Pixel owner in current examples</td><td>WebView</td><td>WebView</td><td>Rust/wgpu surface</td></tr><tr><td>Shader language in current examples</td><td>GLSL ES</td><td>GLSL ES</td><td>WGSL</td></tr><tr><td>Animation/render loop</td><td>JavaScript / p5</td><td>JavaScript / p5</td><td>Rust</td></tr><tr><td>GPU resources</td><td>WebGL objects in JS</td><td>WebGL objects in JS</td><td>wgpu textures/buffers/pipelines in Rust</td></tr><tr><td>Compute in repository baselines</td><td>Not demonstrated by the WebGL 1 baselines</td><td>Not demonstrated by the WebGL 1 baselines</td><td>First-class in the current wgpu examples</td></tr><tr><td>Native services / media bridges</td><td>Rust bridge when an example needs one</td><td>Rust bridge when an example needs one</td><td>Rust-owned and commonly integrated directly with renderer state</td></tr><tr><td>Recording examples</td><td>Browser/canvas recording exists</td><td>Browser/canvas recording exists</td><td>Current native FFmpeg/high-resolution/A/V recording lineage</td></tr><tr><td>NDI / Syphon / Spout</td><td>No dedicated sender example in current v1 tree</td><td>No dedicated sender example in current v2 tree</td><td>Current dedicated Junkpile sender/router references</td></tr></tbody></table></div><div class="callout info"><strong>Capability vs. implementation.</strong>A blank cell or missing example in one track does not mean Tauri or that renderer forbids the capability. It means Junkpile does not currently provide that dedicated reference implementation in that collection.</div></section>

<section class="doc-section" id="software-stack" data-doc-section><span class="doc-kicker">Software stack</span><h2>From reusable layers to standalone tools <a class="anchor-link" href="#software-stack">#</a></h2><div class="diagram"><div class="flow"><div class="flow-node signal"><strong>Inputs</strong><small>UI · files · camera · audio · MIDI · OSC</small></div><div class="flow-arrow">→</div><div class="flow-node"><strong>State</strong><small>JS or Rust canonical parameters</small></div><div class="flow-arrow">→</div><div class="flow-node blue"><strong>Render / compute</strong><small>WebGL or wgpu</small></div><div class="flow-arrow">→</div><div class="flow-node orange"><strong>Outputs</strong><small>preview · record · route · share</small></div><div class="flow-arrow">→</div><div class="flow-node dark"><strong>Standalone app</strong><small>focused creative instrument</small></div></div></div><p>The repository is intentionally product-agnostic. Proven patterns can be reused by focused applications without requiring one monolithic runtime or one mandatory UI.</p></section>

<section class="doc-section" id="architecture" data-doc-section><span class="doc-kicker">Architecture</span><h2>Repository tracks and independent I/O layers <a class="anchor-link" href="#architecture">#</a></h2><div class="grid-3"><div class="diagram"><p class="diagram-title">V1 WebView</p><div class="flow vertical"><div class="flow-node">DOM / browser media</div><div class="flow-arrow">↓</div><div class="flow-node blue">JavaScript / WebGL</div><div class="flow-arrow">↓</div><div class="flow-node dark">Tauri v1 WebView</div></div></div><div class="diagram"><p class="diagram-title">V2 WebView</p><div class="flow vertical"><div class="flow-node">DOM / Tauri 2 IPC</div><div class="flow-arrow">↓</div><div class="flow-node blue">JavaScript / WebGL</div><div class="flow-arrow">↓</div><div class="flow-node dark">Tauri v2 WebView</div></div></div><div class="diagram"><p class="diagram-title">Native wgpu</p><div class="flow vertical"><div class="flow-node">HTML controls / native inputs</div><div class="flow-arrow">↓</div><div class="flow-node blue">Rust / wgpu / WGSL</div><div class="flow-arrow">↓</div><div class="flow-node dark">Metal / Vulkan / DX12</div></div></div></div><p>For the detailed lifecycle/resource model, read <a href="docs/ARCHITECTURE.md">ARCHITECTURE.md</a>.</p></section>

<section class="doc-section" id="v1-track" data-doc-section><span class="doc-kicker">Tauri v1 WebView</span><h2>Accessible first-generation WebView baselines <a class="anchor-link" href="#v1-track">#</a></h2><p>The v1 directory covers p5.js, raw WebGL, external GLSL, webcam, feedback, MIDI, OSC, media playback, recording, compositing, projection, sequences, audio-file analysis, and automation. Use it when maintaining Tauri 1 code or when the older application model is part of the lesson.</p><div class="callout info"><strong>Repository-location note</strong>The current tree contains <code>v1/25-wgpu-ultra-resolution-export</code>. The catalog preserves the actual folder and README rather than pretending it is a WebView project with a different implementation.</div></section>

<section class="doc-section" id="v2-track" data-doc-section><span class="doc-kicker">Tauri v2 WebView</span><h2>Current WebView application path <a class="anchor-link" href="#v2-track">#</a></h2><p>The v2 collection modernizes the same accessible graphics/media ideas around the Tauri 2 application model: capabilities, current window APIs, native dialogs and file workflows, and current IPC/event behavior.</p><div class="callout"><strong>Renderer boundary</strong>These projects still render through the embedded browser/WebView. Tauri 2 changes the application framework; it does not automatically replace WebGL with wgpu.</div></section>

<section class="doc-section" id="wgpu-track" data-doc-section><span class="doc-kicker">Tauri 2 + native Rust/wgpu</span><h2>Native GPU progression <a class="anchor-link" href="#wgpu-track">#</a></h2><p>The native collection now spans fundamentals, compute, 3D, native media, high-resolution export, recording, I/O contracts, external outputs, runtime infrastructure, and application-facing counterparts. These are the repository's current implementations; their presence here does not make every attached transport exclusive to wgpu.</p><div class="grid-3"><div class="card"><h3>Foundations</h3><p>Surface, resize, WGSL, controls, textures, feedback, multipass, backend limits.</p></div><div class="card"><h3>Media + graphics</h3><p>Camera, FFmpeg video, audio, MIDI, OSC, compositing, glTF, deformation.</p></div><div class="card"><h3>I/O + applications</h3><p>Recording, profiles, NDI, Syphon/Spout, routers, appliance runtime, A/V, shader tools.</p></div></div><div class="callout warn"><strong>Numbering</strong>The public catalog keeps the actual project identities. Example 29 is absent and referenced by later projects as quarantined; a historical 19 WGSL-fix copy is not treated as a second public Example 19.</div></section>

<section class="doc-section" id="native-io" data-doc-section><span class="doc-kicker">Current wgpu I/O architecture</span><h2>Frame contracts, backpressure, and output independence <a class="anchor-link" href="#native-io">#</a></h2><p>The wgpu I/O series begins with configuration and a shared frame/output contract, then replaces simulated workers with real FFmpeg recording and adds higher-resolution profiles and external sinks. It demonstrates one reusable architecture for a Rust-owned renderer; it is not a statement that the external transports require wgpu.</p><div class="diagram"><p class="diagram-title">Authoritative-frame architecture</p><div class="flow"><div class="flow-node signal"><strong>Render / compute</strong><small>one authoritative texture</small></div><div class="flow-arrow">→</div><div class="flow-node"><strong>Frame contract</strong><small>dimensions · index · timestamp</small></div><div class="flow-arrow">→</div><div class="flow-node blue"><strong>GPU readback / presentation</strong><small>sink-specific cadence</small></div><div class="flow-arrow">→</div><div class="flow-node orange"><strong>Bounded worker</strong><small>drop instead of blocking</small></div></div></div><h3>Recording lineage</h3><div class="code-shell"><pre><code>27 frame/output contract
  ↓
28 FFmpeg file recording
  ↓
30 high-resolution recording
  ↓
31 validated I/O profiles
  ↓
36 / 39 multi-output routers
  ↓
43 A/V recorder</code></pre></div><p>Preview resolution and output resolution are intentionally independent in the later native projects. A 4K or 8K-class recording is not defined by the visible window size.</p></section>

<section class="doc-section" id="av-recorder" data-doc-section><span class="doc-kicker">Native A/V Recorder</span><h2>Video recording plus selectable audio <a class="anchor-link" href="#av-recorder">#</a></h2><p><code>wgpu/43-wgpu-av-recorder</code> builds on the native high-resolution recorder and adds three audio modes: none, microphone, and local audio file.</p><div class="diagram"><div class="flow"><div class="flow-node signal"><strong>wgpu video</strong><small>H.264 or ProRes path</small></div><div class="flow-arrow">→</div><div class="flow-node"><strong>completed video</strong><small>authoritative duration</small></div><div class="flow-arrow">→</div><div class="flow-node blue"><strong>FFmpeg mux</strong><small>video stream copied</small></div><div class="flow-arrow">→</div><div class="flow-node orange"><strong>final A/V file</strong><small>MP4/AAC or MOV/PCM</small></div></div></div><div class="grid-2"><div class="card"><h3>Microphone</h3><p>CPAL captures the selected input to a temporary 32-bit float WAV while native video recording runs.</p></div><div class="card"><h3>Audio file</h3><p>FFmpeg-readable audio can be selected and looped when shorter than the video recording.</p></div></div><p>On successful mux the intermediate video and temporary microphone file are removed; failures preserve intermediates for diagnosis.</p></section>

<section class="doc-section" id="output-routing" data-doc-section><span class="doc-kicker">Current output-routing references</span><h2>Preview, NDI, recording, Syphon, and Spout <a class="anchor-link" href="#output-routing">#</a></h2><p>The diagram below describes the current <code>wgpu/</code> sender/router implementations. NDI, Syphon, Spout, and FFmpeg are external/native I/O systems, not wgpu features. A WebView application can still use native Rust/platform integrations, but the handoff from WebView-rendered pixels is a separate application-specific bridge and is not represented by dedicated sender examples in the current v1/v2 folders.</p><div class="diagram"><div class="flow"><div class="flow-node signal"><strong>Authoritative wgpu texture</strong></div><div class="flow-arrow">→</div><div class="flow-node"><strong>Preview</strong><small>GPU presentation</small></div><div class="flow-node blue"><strong>NDI</strong><small>readback → BGRA worker</small></div><div class="flow-node orange"><strong>Recording</strong><small>readback → FFmpeg</small></div><div class="flow-node dark"><strong>Platform share</strong><small>Syphon / Spout</small></div></div></div><div class="callout danger"><strong>Network boundary</strong><code>40-wgpu-network-output</code> remains unresolved/under review. Later router/appliance projects intentionally exclude the earlier unresolved network-streaming worker path.</div><div class="grid-2"><div class="card"><h3>Syphon</h3><p>macOS-only. Current example bridges wgpu through CPU BGRA staging into a reusable Metal texture and <code>SyphonMetalServer</code>.</p></div><div class="card"><h3>Spout</h3><p>Windows-only. Current example bridges wgpu through CPU BGRA staging into a Direct3D 11 shared texture.</p></div></div></section>

<section class="doc-section" id="validation" data-doc-section><span class="doc-kicker">Status &amp; validation</span><h2>Evidence should stay explicit <a class="anchor-link" href="#validation">#</a></h2><div class="table-wrap"><table class="data-table"><thead><tr><th>Evidence</th><th>Meaning</th></tr></thead><tbody><tr><td>Source present</td><td>Project exists in the tree.</td></tr><tr><td>Static validation</td><td>Source/config/metadata checks exist; often documented in <code>VALIDATION.md</code>.</td></tr><tr><td>Runtime tested</td><td>A named platform/device path was actually exercised.</td></tr><tr><td>Cross-platform tested</td><td>Behavior was verified across the targeted operating systems.</td></tr><tr><td>Unresolved</td><td>Project remains useful research but should not be used as a stable baseline.</td></tr></tbody></table></div><div class="callout warn"><strong>Current exceptions</strong>Example 29 is absent/quarantined by later documentation. Example 40 remains unresolved. Syphon and Spout are platform-specific. NDI-enabled builds require external SDK/runtime support.</div></section>

<section class="doc-section" id="example-catalog" data-doc-section data-example-filter><span class="doc-kicker">Repository catalog</span><h2>Search the actual project tree <a class="anchor-link" href="#example-catalog">#</a></h2><p>The catalog is generated from <code>docs/examples.json</code>. Historical repair copies can remain in the source tree without being treated as separate public examples.</p><div class="filter-panel"><div><label class="search-field"><span>⌕</span><input data-example-search type="search" placeholder="Search title, folder, capability…" aria-label="Search examples" /></label><div class="filter-group" style="margin-top:12px"><span class="filter-label">Track</span><button class="filter-button is-active" aria-pressed="true" data-filter-key="version" data-filter-value="all">All</button><button class="filter-button" aria-pressed="false" data-filter-key="version" data-filter-value="v1">Tauri v1</button><button class="filter-button" aria-pressed="false" data-filter-key="version" data-filter-value="v2">Tauri v2</button><button class="filter-button" aria-pressed="false" data-filter-key="version" data-filter-value="wgpu">Native wgpu</button></div></div></div><div class="no-results" data-example-no-results>No projects match those filters.</div><div class="example-grid" style="margin-top:22px">{allcards}</div></section>

<section class="doc-section" id="development" data-doc-section><span class="doc-kicker">Development</span><h2>Work from a known baseline <a class="anchor-link" href="#development">#</a></h2><ol class="number-list"><li>Launch the untouched example.</li><li>Confirm its documented input/render/output path.</li><li>Preserve the baseline in version control.</li><li>Change one ownership boundary at a time.</li><li>Keep external workers bounded and observable.</li><li>Record platform/dependency evidence when claiming validation.</li></ol><p>See <a href="docs/DEVELOPMENT.md">DEVELOPMENT.md</a> and <a href="docs/ADDING_AN_EXAMPLE.md">ADDING_AN_EXAMPLE.md</a>.</p></section>

<section class="doc-section" id="troubleshooting" data-doc-section><span class="doc-kicker">Troubleshooting</span><h2>Diagnose the owner of the failure <a class="anchor-link" href="#troubleshooting">#</a></h2><div class="grid-3"><div class="card"><h3>WebView</h3><p>Console, shader compile/link, media permission, browser texture upload, WebSocket state.</p></div><div class="card"><h3>Native GPU</h3><p>Adapter/backend, surface state, bind groups, buffer alignment, texture formats, resource usage.</p></div><div class="card"><h3>I/O worker</h3><p>Readback slots, CPU pools, bounded queues, FFmpeg stderr, SDK/runtime dependencies.</p></div></div><p>See the full <a href="docs/TROUBLESHOOTING.md">troubleshooting guide</a>.</p></section>

<section class="doc-section" id="glossary" data-doc-section><span class="doc-kicker">Glossary</span><h2>Core terms <a class="anchor-link" href="#glossary">#</a></h2><dl class="glossary-grid"><div class="glossary-item"><dt>Authoritative texture</dt><dd>The renderer-owned GPU image that represents the canonical frame before presentation/output-specific adaptation.</dd></div><div class="glossary-item"><dt>Bounded queue</dt><dd>A queue with a fixed capacity so slow output work produces visible pressure/drops rather than unbounded memory growth.</dd></div><div class="glossary-item"><dt>WebView</dt><dd>The embedded browser engine that renders HTML/CSS/JavaScript inside a desktop application.</dd></div><div class="glossary-item"><dt>wgpu</dt><dd>Rust graphics API used by Junkpile's native renderer path over Metal, Vulkan, and Direct3D 12.</dd></div><div class="glossary-item"><dt>WGSL</dt><dd>Shader language used by the native wgpu projects.</dd></div><div class="glossary-item"><dt>Readback</dt><dd>Copying GPU texture/buffer data into CPU-visible memory, commonly required by encoders or external APIs.</dd></div><div class="glossary-item"><dt>Sink</dt><dd>An independent consumer of rendered frames such as preview, recorder, NDI, Syphon, or Spout.</dd></div><div class="glossary-item"><dt>Last-known-good</dt><dd>A runtime configuration/shader strategy that rejects invalid edits while preserving the previous working state.</dd></div></dl></section>
</div></main>
{footer()}
</body></html>'''

(ROOT/'index.html').write_text(index_page(),encoding='utf-8')
(ROOT/'docs.html').write_text(docs_page(),encoding='utf-8')
print('Built index.html and docs.html from docs/examples.json')
