from datetime import date, timedelta, datetime, timezone
from pathlib import Path
from typing import Optional
import os
import asyncio

import httpx
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

BASE = Path(__file__).parent
app = FastAPI(title="ASTRA EYE 3D", version="1.0.0")
app.mount("/static", StaticFiles(directory=BASE / "static"), name="static")

NASA_API_KEY = os.getenv("NASA_API_KEY", "DEMO_KEY")
NASA_FEED = "https://api.nasa.gov/neo/rest/v1/feed"
JPL_CAD = "https://ssd-api.jpl.nasa.gov/cad.api"
# Canonical JPL identities verified using the Horizons Lookup API.
JPL_CANONICAL_IDS = {
    "2679786": "20679786",
    "54051300": "20679786",
    "3430309": "20614134",
    "2614134": "20614134",
}

@app.get("/")
async def index():
    return FileResponse(BASE / "static" / "index.html")

@app.get("/api/health")
async def health():
    return {
        "status": "online",
        "app": "ASTRA EYE 3D",
        "orbital_data": "Live external API when available",
        "camera": "Browser-local; video is not uploaded by this app"
    }

@app.get("/api/detection-status")
async def detection_status():
    """Report the local ESA FITS experiment; this is not a validated asteroid detector."""
    import json

    report_path = BASE / "detection" / "esa_three_frame_filtered_tracks.json"
    if not report_path.is_file():
        return {
            "status": "UNAVAILABLE",
            "validated_detection": False,
            "message": "ESA experiment report was not found.",
        }

    try:
        report = json.loads(report_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=500, detail=f"Could not read ESA experiment report: {exc}")

    tracks = report.get("candidate_tracks") or []
    return {
        "status": "PROCESSED_UNVALIDATED",
        "experiment": "ESA Optical Ground Station (J04) three-frame FITS test",
        "observation_date": "2015-10-09",
        "image_count": len(report.get("files", [])),
        "files": report.get("files", []),
        "source_counts_after_filter": report.get("source_counts_after_filter", []),
        "candidate_track_count": report.get("candidate_track_count", len(tracks)),
        "candidate_tracks": tracks,
        "validated_detection": False,
        "warning": report.get(
            "warning",
            "Exploratory tracks only; no asteroid identity has been established.",
        ),
    }



@app.post(
    "/api/detection/analyze-three-frames",
    response_model=None,
)
async def analyze_three_frames(
    frame1: UploadFile = File(..., description="First image frame"),
    frame2: UploadFile = File(..., description="Second image frame"),
    frame3: UploadFile = File(..., description="Third image frame"),
):

    """Experimental three-frame image analysis. Does not confirm asteroid identity."""
    import sys
    import tempfile
    import cv2
    import numpy as np
    frames = [frame1, frame2, frame3]
   
    if len(frames) != 3:
        raise HTTPException(
            status_code=400,
            detail="Upload exactly three image frames."
        )

    allowed_extensions = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".fits", ".fit", ".fts"}
    max_file_bytes = 15 * 1024 * 1024
    max_pixels = 25_000_000
    upload_names = []
    image_bytes = []
    image_shapes = []

    for index, upload in enumerate(frames, start=1):
        name = upload.filename or f"frame_{index}.png"
        suffix = Path(name).suffix.lower()

        if suffix not in allowed_extensions:
            raise HTTPException(
                status_code=415,
                detail=f"Frame {index}: unsupported image extension. "
                       "Use PNG, JPG, JPEG, TIF, TIFF or FITS."
            )

        data = await upload.read(max_file_bytes + 1)
        if not data:
            raise HTTPException(
                status_code=400,
                detail=f"Frame {index} is empty."
            )
        if len(data) > max_file_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"Frame {index} exceeds the 15 MiB upload limit."
            )

        if suffix in {".fits", ".fit", ".fts"}:
            from io import BytesIO
            from astropy.io import fits

            try:
                with fits.open(BytesIO(data), memmap=False) as hdul:
                    fits_data = hdul[0].data
                    if fits_data is None or fits_data.ndim != 2:
                        raise ValueError("Expected a 2D primary FITS image.")
                    height, width = fits_data.shape
            except Exception as exc:
                raise HTTPException(
                    status_code=415,
                    detail=f"Frame {index} is not a readable FITS image: {exc}"
                ) from exc
        else:
            encoded = np.frombuffer(data, dtype=np.uint8)
            image = cv2.imdecode(encoded, cv2.IMREAD_UNCHANGED)
            if image is None or image.size == 0:
                raise HTTPException(
                    status_code=415,
                    detail=f"Frame {index} is not a readable image."
                )
            height, width = image.shape[:2]
        if width * height > max_pixels:
            raise HTTPException(
                status_code=413,
                detail=f"Frame {index} exceeds the 25-megapixel limit."
            )

        upload_names.append(Path(name).name)
        image_bytes.append((suffix, data))
        image_shapes.append((height, width))

    if len(set(image_shapes)) != 1:
        raise HTTPException(
            status_code=400,
            detail="All three frames must have identical image dimensions."
        )

    detection_dir = str(BASE / "detection")
    if detection_dir not in sys.path:
        sys.path.insert(0, detection_dir)

    try:
        from three_frame_pipeline import run_pipeline

        with tempfile.TemporaryDirectory(prefix="astra_eye_frames_") as temp:
            temp_paths = []
            for index, (suffix, data) in enumerate(image_bytes, start=1):
                temp_path = Path(temp) / f"frame_{index}{suffix}"
                temp_path.write_bytes(data)
                temp_paths.append(str(temp_path))

            import asyncio
            result = await asyncio.to_thread(run_pipeline, temp_paths)

        # Do not expose temporary server filesystem paths in the API response.
        result["input_files"] = upload_names
        result["status"] = "PROCESSED_UNCONFIRMED"
        result["validated_detection"] = False
        result["warning"] = (
            "Experimental image-processing output only. Tracks are unconfirmed "
            "candidates, not identified asteroids. This baseline does not perform "
            "full astrometric calibration or independent known-object confirmation. "
            "Use calibrated, time-separated astronomical exposures."
        )
        return result

    except HTTPException:
        raise
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Image analysis failed: {type(exc).__name__}: {exc}"
        ) from exc
    finally:
        for upload in frames:
            await upload.close()


@app.get("/api/asteroids")
async def asteroids(start_date: Optional[str] = None, days: int = 3):
    """Fetch near-Earth objects from NASA NeoWs. Camera images are never sent here."""
    try:
        days = max(1, min(int(days), 7))
        start = date.fromisoformat(start_date) if start_date else date.today()
        end = start + timedelta(days=days - 1)
        params = {"start_date": start.isoformat(), "end_date": end.isoformat(), "api_key": NASA_API_KEY}
        async with httpx.AsyncClient(timeout=18) as client:
            r = await client.get(NASA_FEED, params=params)
            r.raise_for_status()
            payload = r.json()
        
        objects = []
        for day, entries in payload.get("near_earth_objects", {}).items():
            for neo in entries:
                approach = (neo.get("close_approach_data") or [{}])[0]
                estimated = neo.get("estimated_diameter", {}).get("meters", {})

                objects.append({
                    "id": neo.get("id"),
                    "canonical_jpl_id": JPL_CANONICAL_IDS.get(str(neo.get("id"))),
                    "name": neo.get("name", "Unknown object"),
                    "nasa_jpl_url": neo.get("nasa_jpl_url"),
                    "absolute_magnitude_h": neo.get("absolute_magnitude_h"),
                    "diameter_min_m": estimated.get("estimated_diameter_min"),
                    "diameter_max_m": estimated.get("estimated_diameter_max"),
                    "potentially_hazardous": neo.get("is_potentially_hazardous_asteroid", False),
                    "close_approach_date": approach.get("close_approach_date"),
                    "close_approach_date_full": approach.get("close_approach_date_full"),
                    "relative_velocity_km_s": (approach.get("relative_velocity") or {}).get("kilometers_per_second"),
                    "miss_distance_km": (approach.get("miss_distance") or {}).get("kilometers"),
                    "orbiting_body": approach.get("orbiting_body", "Earth"),
                    "data_date": day,
                    "data_source": "NASA NeoWs"
                })

        objects.sort(key=lambda x: float(x.get("miss_distance_km") or 1e99))

        

        return {"source": "NASA NeoWs", "start_date": start.isoformat(), "end_date": end.isoformat(),
                "count": len(objects), "asteroids": objects}
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"NASA API returned {e.response.status_code}. Try again or set a NASA API key.")
    except (httpx.RequestError, ValueError) as e:
        raise HTTPException(status_code=502, detail=f"Could not retrieve live NASA data: {str(e)}")

JPL_SBDB = "https://ssd-api.jpl.nasa.gov/sbdb.api"

@app.get("/api/search-asteroid")
async def search_asteroid(q: str):
    """Look up a small body by name/designation in JPL SBDB."""
    query = q.strip()
    if len(query) < 2:
        raise HTTPException(status_code=422, detail="Enter at least 2 characters.")
    if len(query) > 100:
        raise HTTPException(status_code=422, detail="Search query is too long.")

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(JPL_SBDB, params={"sstr": query})
            response.raise_for_status()
            payload = response.json()

        obj = payload.get("object")
        if not obj:
            return {"found": False, "query": query, "source": "JPL SBDB"}

        orbit = payload.get("orbit") or {}
        physical = payload.get("phys_par") or []

        def physical_value(parameter_name):
            for item in physical:
                if str(item.get("name", "")).lower() == parameter_name.lower():
                    return {
                        "value": item.get("value"),
                        "units": item.get("units")
                    }
            return None

        return {
            "found": True,
            "query": query,
            "source": "JPL SBDB",
            "name": obj.get("fullname") or obj.get("des") or query,
            "designation": obj.get("des"),
            "spkid": obj.get("spkid"),
            "kind": obj.get("kind"),
            "neo": obj.get("neo"),
            "pha": obj.get("pha"),
            "orbit_class": (obj.get("orbit_class") or {}).get("name"),
            "orbit_class_code": (obj.get("orbit_class") or {}).get("code"),
            "moid_au": orbit.get("moid"),
            "absolute_magnitude": physical_value("H"),
            "diameter": physical_value("diameter")
        }
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=502,
            detail=f"JPL SBDB returned HTTP {e.response.status_code}."
        )
    except httpx.RequestError:
        raise HTTPException(
            status_code=502,
            detail="JPL SBDB is unavailable. Check your internet connection and retry."
        )
    except ValueError:
        raise HTTPException(status_code=502, detail="JPL SBDB returned invalid data.")

@app.get("/api/cad")
async def cad(limit: int = 20):
    """JPL close-approach records. Useful fallback/context endpoint."""
    try:
        async with httpx.AsyncClient(timeout=18) as client:
            r = await client.get(JPL_CAD, params={"date-min": date.today().isoformat(),
                "date-max": (date.today() + timedelta(days=30)).isoformat(),
                "dist-max": "0.2", "sort": "date", "limit": max(1, min(limit, 50)),
                "fullname": "true"})
            r.raise_for_status()
            return r.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"JPL close-approach service unavailable: {e}")

@app.get("/api/horizons-position")
async def horizons_position(designation: str):
    """Get an Earth-centered asteroid position from NASA/JPL Horizons."""
    import csv
    import math
    import re

    designation = designation.strip()
    if designation.startswith('(') and designation.endswith(')'):
        designation = designation[1:-1].strip()
    numbered_name = re.match(r"^(\d+)\s+(?![A-Za-z]{1,2}\d{0,4}\b)", designation)
    if numbered_name:
        designation = numbered_name.group(1)

    if not re.fullmatch(r"[A-Za-z0-9 ()+._-]{1,80}", designation):
        raise HTTPException(status_code=400, detail="Invalid asteroid designation.")

    now = datetime.now(timezone.utc).replace(
        second=0, microsecond=0
    ) + timedelta(minutes=2)

    stop = now + timedelta(minutes=2)

    params = {
        "format": "json",
        "COMMAND": f"'{designation};'",
        "OBJ_DATA": "NO",
        "MAKE_EPHEM": "YES",
        "EPHEM_TYPE": "VECTORS",
        "CENTER": "500@399",
        "REF_PLANE": "FRAME",
        "REF_SYSTEM": "ICRF",
        "OUT_UNITS": "KM-S",
        "VEC_TABLE": "1",
        "VEC_LABELS": "NO",
        "CSV_FORMAT": "YES",
        "START_TIME": now.strftime("%Y-%m-%d %H:%M"),
        "STOP_TIME": stop.strftime("%Y-%m-%d %H:%M"),
        "STEP_SIZE": "1 m",
    }

    try:
        async with httpx.AsyncClient(timeout=25) as client:
            payload = None

            for attempt in range(3):
                try:
                    response = await client.get(
                        "https://ssd.jpl.nasa.gov/api/horizons.api",
                        params=params,
                    )
                    response.raise_for_status()
                    payload = response.json()
                    break

                except httpx.HTTPStatusError as exc:
                    retryable = exc.response.status_code in (502, 503, 504)

                    if not retryable or attempt == 2:
                        raise

                    await asyncio.sleep(1.0 * (attempt + 1))

                except httpx.RequestError:
                    if attempt == 2:
                        raise

                    await asyncio.sleep(1.0 * (attempt + 1))

            if payload is None:
                raise HTTPException(
                    status_code=502,
                    detail="JPL Horizons request failed after retries.",
                )

        if payload.get("error"):
            raise HTTPException(
                status_code=502,
                detail=f"JPL Horizons: {payload['error']}",
            )

        result = payload.get("result", "")

        if "$$SOE" not in result or "$$EOE" not in result:
            raise HTTPException(
                status_code=502,
                detail="JPL Horizons returned no position vectors.",
            )

        block = result.split("$$SOE", 1)[1].split("$$EOE", 1)[0]
        rows = [line.strip() for line in block.splitlines() if line.strip()]

        if not rows:
            raise HTTPException(
                status_code=502,
                detail="JPL Horizons returned an empty result.",
            )

        columns = next(csv.reader([rows[0]], skipinitialspace=True))

        if len(columns) < 5:
            raise HTTPException(
                status_code=502,
                detail="Unexpected JPL Horizons vector format.",
            )

        x_km, y_km, z_km = map(float, columns[2:5])
        distance_km = math.sqrt(x_km**2 + y_km**2 + z_km**2)

        return {
            "source": "NASA/JPL Horizons API",
            "designation": designation,
            "epoch": columns[1].strip(),
            "center": "Earth geocenter (399)",
            "frame": "ICRF",
            "units": "km",
            "x_km": x_km,
            "y_km": y_km,
            "z_km": z_km,
            "distance_km": distance_km,
        }

    except HTTPException:
        raise
    except (httpx.HTTPError, ValueError, KeyError, IndexError) as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Could not retrieve a JPL Horizons position: {exc}",
        )


@app.get("/api/horizons-trail")
async def horizons_trail(designation: str):
    """Return time-sampled Earth-centered positions from NASA/JPL Horizons."""
    import csv
    import math
    import re

    designation = designation.strip()
    if designation.startswith('(') and designation.endswith(')'):
        designation = designation[1:-1].strip()
    numbered_name = re.match(r"^(\d+)\s+(?![A-Za-z]{1,2}\d{0,4}\b)", designation)
    if numbered_name:
        designation = numbered_name.group(1)
    if not re.fullmatch(r"[A-Za-z0-9 ()+._-]{1,80}", designation):
        raise HTTPException(status_code=400, detail="Invalid asteroid designation.")

    start = datetime.now(timezone.utc).replace(second=0, microsecond=0) + timedelta(minutes=2)
    stop = start + timedelta(hours=24)

    params = {
        "format": "json",
        "COMMAND": f"'{designation};'",
        "OBJ_DATA": "NO",
        "MAKE_EPHEM": "YES",
        "EPHEM_TYPE": "VECTORS",
        "CENTER": "500@399",
        "REF_PLANE": "FRAME",
        "REF_SYSTEM": "ICRF",
        "OUT_UNITS": "KM-S",
        "VEC_TABLE": "1",
        "VEC_LABELS": "NO",
        "CSV_FORMAT": "YES",
        "START_TIME": start.strftime("%Y-%m-%d %H:%M"),
        "STOP_TIME": stop.strftime("%Y-%m-%d %H:%M"),
        "STEP_SIZE": "2 h",
    }

    try:
        async with httpx.AsyncClient(timeout=35) as client:
            for attempt in range(3):
                try:
                    response = await client.get(
                        "https://ssd.jpl.nasa.gov/api/horizons.api",
                        params=params,
                    )
                    response.raise_for_status()
                    payload = response.json()
                    break
                except httpx.HTTPStatusError as exc:
                    if exc.response.status_code not in (502, 503, 504) or attempt == 2:
                        raise
                except httpx.RequestError:
                    if attempt == 2:
                        raise

                await asyncio.sleep(1.0 * (attempt + 1))

        if payload.get("error"):
            raise HTTPException(status_code=502, detail=f"JPL Horizons: {payload['error']}")

        result = payload.get("result", "")
        if "$$SOE" not in result or "$$EOE" not in result:
            raise HTTPException(
                status_code=502,
                detail="JPL Horizons returned no trajectory samples.",
            )

        block = result.split("$$SOE", 1)[1].split("$$EOE", 1)[0]
        rows = [line.strip() for line in block.splitlines() if line.strip()]
        samples = []

        for row in rows:
            columns = next(csv.reader([row], skipinitialspace=True))
            if len(columns) < 5:
                continue

            try:
                x_km, y_km, z_km = map(float, columns[2:5])
            except ValueError:
                continue

            samples.append({
                "epoch": columns[1].strip(),
                "x_km": x_km,
                "y_km": y_km,
                "z_km": z_km,
                "distance_km": math.sqrt(x_km**2 + y_km**2 + z_km**2),
            })

        if len(samples) < 2:
            raise HTTPException(
                status_code=502,
                detail="JPL Horizons returned fewer than two usable position samples.",
            )

        return {
            "source": "NASA/JPL Horizons API",
            "designation": designation,
            "center": "Earth geocenter (399)",
            "frame": "ICRF",
            "units": "km",
            "step": "2 hours",
            "samples": samples,
            "count": len(samples),
        }

    except HTTPException:
        raise
    except (httpx.HTTPError, ValueError, KeyError, IndexError) as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Could not retrieve JPL Horizons trajectory samples: {exc}",
        )




