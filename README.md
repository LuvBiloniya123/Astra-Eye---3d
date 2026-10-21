# ASTRA EYE 3D

A local-first asteroid monitoring dashboard with a Three.js 3D scene, NASA Near Earth Object (NeoWs) data, browser camera preview, and local image capture.

## What is real vs simulated?

**Real when the APIs are reachable**
- Asteroid names and identifiers, estimated diameter ranges, NASA hazard classification, close-approach date, relative velocity, and miss distance returned by NASA NeoWs.
- Browser camera video from a camera the user explicitly selects/grants permission to use.
- Captured still images from the selected camera, saved locally by the browser.

**Visualisation only / illustrative**
- The 3D asteroid positions, orbit curves, asteroid sizes in the scene, radar sweep, and paths are schematic visuals. NeoWs feed data is not a full ephemeris and does not provide a full set of 3D coordinates for every object.
- The interface does not identify asteroids inside camera frames, perform astrometric plate-solving, or prove a camera detection is a real asteroid.
- The visual “track” is not a spacecraft capture system. No spacecraft control or physical capture function exists.

## Requirements

- Python 3.10+
- Modern Chrome/Edge/Firefox
- Webcam or supported astronomy camera exposed to the OS as a standard camera device
- Internet for live NASA API data and Three.js CDN

## Run on Windows

1. Extract the ZIP.
2. Open PowerShell/Terminal in the extracted `astra_eye_3d` folder.
3. Create a virtual environment and install packages:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

4. Optional: create a `.env` file from `.env.example` and set your NASA API key. For a simple local setup, set the environment variable in PowerShell:

```powershell
$env:NASA_API_KEY="YOUR_NASA_API_KEY"
```

Get a key from https://api.nasa.gov/ . `DEMO_KEY` is rate-limited.

5. Start the server:

```powershell
uvicorn app:app --reload
```

6. Open http://127.0.0.1:8000

## Run on macOS/Linux

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export NASA_API_KEY="YOUR_NASA_API_KEY"  # optional
uvicorn app:app --reload
```

Then visit http://127.0.0.1:8000.

## Camera notes

- Click **Connect camera** and grant browser permission.
- Choose a camera from the dropdown. A telescope camera needs to be recognized by the operating system/browser as a video input. Some scientific cameras require vendor drivers or capture software; this starter app does not directly control ASCOM/INDI equipment.
- The app does not upload or transmit the camera feed. Captures are downloaded by your browser.
- Camera access normally works on `localhost` or HTTPS, not on an arbitrary insecure network address.

## Data and privacy

The backend makes outbound requests to NASA/JPL for orbital data. Browser camera video stays in the browser; no endpoint in this application receives video frames. Use only cameras you own or have permission to access.

## API routes

- `GET /api/health`
- `GET /api/asteroids?days=3` — NASA NeoWs feed, 1–7 days
- `GET /api/cad?limit=20` — JPL close-approach API (next 30 days, within 0.2 AU)

## Troubleshooting

- **NASA API error / 429:** wait or configure a personal API key.
- **Camera list is empty:** check OS permissions, close other apps using the camera, refresh, and ensure the device appears in system settings.
- **Three.js does not load:** ensure internet access is available for the CDN.
## Three-frame image analysis

The experimental API endpoint POST /api/detection/analyze-three-frames accepts three PNG, JPG/JPEG, or TIFF images. GET /api/detection-status reports detector status.

Synthetic regression tests:
py -m pytest .\detection\test_script_runner.py -q

## ESA real-data experiment and limitations

Three ESA Optical Ground Station FITS images were examined. Separate WCS plate solutions were obtained, and candidate brightness and positions were inspected. The candidate shows very small, inconsistent apparent motion. No confirmed asteroid detection has been established.

The ESA experiment is exploratory and not scientifically validated. Confirming a detection requires reliable astrometry, uncertainty analysis, and independent comparison with known-object ephemerides. Do not present the current candidate as a confirmed asteroid discovery.

The 3D scene is illustrative. The application does not control spacecraft or capture asteroids.
