# Barcode scanning uses zxing-js only

Scanning uses the vendored `@zxing/browser`, loaded lazily when Scan is pressed. A native `BarcodeDetector` and zxing-cpp (WebAssembly) were benched against it on an iPhone and an Android phone with `bench.html` and were not better, so a second decoder would only add code and a download.

## Consequences

- The camera is asked for up to 1920x1080 and continuous focus (all `ideal`); without that a phone gives 480x640 and dim-light scans fail.
- The camera plays in an out-of-sight `<video>` and the picture is drawn on a `<canvas>`, because the `<video>` shown by itself jumped on an iPhone while it started. The numbers (`VIDEO`, `PREVIEW_FPS`, `MIN_SCAN_MS`) are in `src/scanner.js`.
- Retune with `bench.html` (not linked from the app; "hold 5 s" gives the share of frames decoded), not by guessing.
- While the camera is on, every control of the lists is disabled (edit, sort, Copy, Clear, the rows' names and buttons) and edit mode ends: no changing the lists mid-scan. The field and Search are locked too; Stop is the way out.
