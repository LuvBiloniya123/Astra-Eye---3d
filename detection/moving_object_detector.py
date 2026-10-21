import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def _load_gray(path):
    image = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    if image is None:
        raise ValueError(f"Cannot read image: {path}")
    return image


def _components(mask, min_area, max_area):
    count, labels, stats, centers = cv2.connectedComponentsWithStats(
        mask, connectivity=8
    )
    items = []
    for i in range(1, count):
        area = int(stats[i, cv2.CC_STAT_AREA])
        if min_area <= area <= max_area:
            items.append({
                "x": float(centers[i][0]),
                "y": float(centers[i][1]),
                "area": area,
            })
    return items


def _estimate_global_translation(reference, moving):
    """Estimate global translation only when the reference has distributed features."""
    points = cv2.goodFeaturesToTrack(
        reference, maxCorners=250, qualityLevel=0.01,
        minDistance=5, blockSize=3
    )
    if points is None or len(points) < 4:
        return moving, {
            "applied": False,
            "reason": "Insufficient reference features",
            "dx_px": 0.0, "dy_px": 0.0, "response": 0.0,
        }

    xy = points.reshape(-1, 2)
    spread_x = float(np.ptp(xy[:, 0]))
    spread_y = float(np.ptp(xy[:, 1]))
    if spread_x < 25 or spread_y < 25:
        return moving, {
            "applied": False,
            "reason": "Reference features are not spatially distributed",
            "dx_px": 0.0, "dy_px": 0.0, "response": 0.0,
        }

    ref_float = reference.astype(np.float32)
    mov_float = moving.astype(np.float32)
    ref_float -= float(np.mean(ref_float))
    mov_float -= float(np.mean(mov_float))

    (dx, dy), response = cv2.phaseCorrelate(ref_float, mov_float)
    dx, dy, response = float(dx), float(dy), float(response)

    if not np.isfinite([dx, dy, response]).all():
        reason = "Non-finite alignment estimate"
    elif response < 0.10:
        reason = "Low phase-correlation response"
    elif abs(dx) > 10 or abs(dy) > 10:
        reason = "Estimated translation exceeds 10-pixel safety limit; alignment skipped"
    else:
        matrix = np.float32([[1, 0, -dx], [0, 1, -dy]])
        aligned = cv2.warpAffine(
            moving, matrix, (moving.shape[1], moving.shape[0]),
            flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT,
            borderValue=0
        )
        return aligned, {
            "applied": True,
            "reason": "Global translation compensated",
            "dx_px": round(dx, 3),
            "dy_px": round(dy, 3),
            "response": round(response, 4),
        }

    return moving, {
        "applied": False,
        "reason": reason,
        "dx_px": round(dx, 3) if np.isfinite(dx) else None,
        "dy_px": round(dy, 3) if np.isfinite(dy) else None,
        "response": round(response, 4) if np.isfinite(response) else None,
    }


def detect_moving_candidates(
    before, after, threshold=25, min_area=3,
    max_area=300, max_motion_px=80
):
    """Find paired bright-source changes in two already aligned images.

    Coordinates are image pixels. Results are candidate movements, not
    confirmed asteroid detections. Images should be calibrated and aligned.
    """
    if before is None or after is None:
        raise ValueError("Both input images are required.")

    if before.shape != after.shape:
        raise ValueError("Images must have the same dimensions.")

    if before.ndim == 3:
        before = cv2.cvtColor(before, cv2.COLOR_BGR2GRAY)
    if after.ndim == 3:
        after = cv2.cvtColor(after, cv2.COLOR_BGR2GRAY)

    before = before.astype(np.uint8)
    after = after.astype(np.uint8)

    # Align global camera translation when the reference field supports it.
    after, alignment = _estimate_global_translation(before, after)

    # Positive changes mark new/brighter pixels; negative changes mark
    # old/brighter pixels. Static sources ideally cancel after alignment.
    delta = after.astype(np.int16) - before.astype(np.int16)
    positive = (delta >= threshold).astype(np.uint8) * 255
    negative = (delta <= -threshold).astype(np.uint8) * 255

    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    positive = cv2.morphologyEx(positive, cv2.MORPH_OPEN, kernel)
    negative = cv2.morphologyEx(negative, cv2.MORPH_OPEN, kernel)

    old_sources = _components(negative, min_area, max_area)
    new_sources = _components(positive, min_area, max_area)

    
    pairs = []
    used_new = set()

    # Spatial grid limits the search to nearby detections.
    # This avoids comparing every old source with every new source.
    cell_size = max(1.0, float(max_motion_px))
    spatial_grid = {}

    for j, new in enumerate(new_sources):
        cell_x = int(new["x"] // cell_size)
        cell_y = int(new["y"] // cell_size)
        spatial_grid.setdefault((cell_x, cell_y), []).append((j, new))

    for old in old_sources:
        cell_x = int(old["x"] // cell_size)
        cell_y = int(old["y"] // cell_size)
        choices = []

        # Search this grid cell and its eight neighbours.
        for gx in range(cell_x - 1, cell_x + 2):
            for gy in range(cell_y - 1, cell_y + 2):
                for j, new in spatial_grid.get((gx, gy), []):
                    if j in used_new:
                        continue

                    distance = float(np.hypot(
                        new["x"] - old["x"],
                        new["y"] - old["y"],
                    ))

                    if 0 < distance <= max_motion_px:
                        choices.append((distance, j, new))

        if not choices:
            continue

        distance, j, new = min(choices, key=lambda item: item[0])
        used_new.add(j)

        pairs.append({
            "from_px": {
                "x": round(old["x"], 2),
                "y": round(old["y"], 2),
            },
            "to_px": {
                "x": round(new["x"], 2),
                "y": round(new["y"], 2),
            },
            "displacement_px": round(distance, 2),
            "old_blob_area_px": old["area"],
            "new_blob_area_px": new["area"],
            "status": "UNCONFIRMED MOVING-OBJECT CANDIDATE",
        })


    return {
        "method": "OpenCV aligned-frame differencing",
        "image_width_px": int(before.shape[1]),
        "image_height_px": int(before.shape[0]),
        "threshold": threshold,
        "global_alignment": alignment,
        "candidate_count": len(pairs),
        "candidates": pairs,
        "warning": (
            "Candidates are not confirmed asteroids. Image alignment, "
            "calibration, multiple exposures, and false-positive checks "
            "are required for astronomical use."
        ),
    }


def main():
    parser = argparse.ArgumentParser(
        description="Compare two aligned images for moving-source candidates."
    )
    parser.add_argument("before", help="Earlier image path")
    parser.add_argument("after", help="Later image path")
    parser.add_argument("--threshold", type=int, default=25)
    parser.add_argument("--max-motion", type=float, default=80)
    args = parser.parse_args()

    first = _load_gray(args.before)
    second = _load_gray(args.after)
    result = detect_moving_candidates(
        first, second,
        threshold=args.threshold,
        max_motion_px=args.max_motion,
    )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()