{
  "patcher": {
    "fileversion": 1,
    "appversion": { "major": 8, "minor": 6, "revision": 0, "architecture": "x64", "modernui": 1 },
    "classnamespace": "box",
    "rect": [80.0, 80.0, 720.0, 420.0],
    "bglocked": 0,
    "openinpresentation": 0,
    "default_fontsize": 12.0,
    "default_fontface": 0,
    "default_fontname": "Arial",
    "gridonopen": 1,
    "gridsize": [15.0, 15.0],
    "boxes": [
      { "box": { "id": "obj-1", "maxclass": "comment", "text": "Junkpile OSC test — move the slider", "patching_rect": [30.0, 25.0, 260.0, 20.0] } },
      { "box": { "id": "obj-2", "maxclass": "slider", "size": 128.0, "patching_rect": [30.0, 65.0, 28.0, 220.0] } },
      { "box": { "id": "obj-3", "maxclass": "newobj", "text": "scale 0 127 0. 1.", "patching_rect": [95.0, 105.0, 118.0, 22.0] } },
      { "box": { "id": "obj-4", "maxclass": "newobj", "text": "oscformat hue", "patching_rect": [95.0, 155.0, 92.0, 22.0] } },
      { "box": { "id": "obj-5", "maxclass": "newobj", "text": "udpsend 127.0.0.1 9000", "patching_rect": [95.0, 205.0, 168.0, 22.0] } },
      { "box": { "id": "obj-6", "maxclass": "flonum", "patching_rect": [95.0, 65.0, 70.0, 22.0] } },
      { "box": { "id": "obj-7", "maxclass": "comment", "text": "Change 'hue' to zoom, rotation, field, turbulence, trail, exposure, or pulse_decay.", "patching_rect": [300.0, 155.0, 360.0, 42.0] } }
    ],
    "lines": [
      { "patchline": { "source": ["obj-2", 0], "destination": ["obj-3", 0] } },
      { "patchline": { "source": ["obj-3", 0], "destination": ["obj-6", 0] } },
      { "patchline": { "source": ["obj-3", 0], "destination": ["obj-4", 0] } },
      { "patchline": { "source": ["obj-4", 0], "destination": ["obj-5", 0] } }
    ]
  }
}
