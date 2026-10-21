import argparse
import json
from pathlib import Path

import cv2
import numpy as np

from moving_object_detector import detect_moving_candidates
from test_alignment import align_translation


def load_gray(path):
    path = Path(path)
    if path.suffix.lower() in {".fits", ".fit", ".fts"}:
        from astropy.io import fits

        with fits.open(path, memmap=False) as hdul:
            if hdul[0].data is None:
                raise ValueError(f"No primary image data in FITS: {path}")
            image = np.asarray(hdul[0].data, dtype=np.float32)

        if image.ndim != 2:
            raise ValueError(
                f"Expected a 2D FITS image in {path}, got shape {image.shape}"
            )
        if not np.isfinite(image).any():
            raise ValueError(f"FITS image has no finite pixel values: {path}")
        return image

    image = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    if image is None:
        raise FileNotFoundError(f"Cannot read image: {path}")
    if image.ndim == 3:
        image = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    return image.astype(np.float32)


def run_pipeline(paths, threshold=25, max_motion_px=30,
                 min_alignment_response=0.10):
    if len(paths) != 3:
        raise ValueError("Exactly three image paths are required.")

    raw_frames = [load_gray(path) for path in paths]
    if any(frame.shape != raw_frames[0].shape for frame in raw_frames):
        raise ValueError("All three images must have identical dimensions.")

    # Use one shared intensity scale across all frames, not a separate
    # min/max stretch for each exposure.
    samples = [
        frame[::8, ::8].ravel()
        for frame in raw_frames
    ]
    finite_samples = np.concatenate([
        sample[np.isfinite(sample)] for sample in samples
        if np.isfinite(sample).any()
    ])
    if finite_samples.size == 0:
        raise ValueError("No finite pixel values found in the input frames.")

    low, high = np.percentile(finite_samples, [1.0, 99.5])

    # Sparse synthetic images may have a constant sampled background because
    # the downsample misses the bright sources. Fall back to the finite pixel
    # range while keeping one common scale for all three frames.
    if not np.isfinite([low, high]).all() or high <= low:
        finite_values = [
            frame[np.isfinite(frame)]
            for frame in raw_frames
            if np.isfinite(frame).any()
        ]
        if not finite_values:
            raise ValueError("No finite pixel values found in the input frames.")

        low = min(float(values.min()) for values in finite_values)
        high = max(float(values.max()) for values in finite_values)

    if not np.isfinite([low, high]).all() or high <= low:
        raise ValueError(
            "Could not establish a valid shared intensity scale: "
            "all usable pixels have the same value."
        )

    frames = [
        np.clip((np.nan_to_num(frame, nan=low) - low) * (255.0 / (high - low)),
                0, 255).astype(np.uint8)
        for frame in raw_frames
    ]
    if any(frame.shape != frames[0].shape for frame in frames):
        raise ValueError("All three images must have identical dimensions.")

    reference = frames[0]
    aligned = [reference]
    alignment = [{
        "frame": 1,
        "dx_px": 0.0,
        "dy_px": 0.0,
        "response": 1.0,
        "status": "REFERENCE FRAME",
    }]

    for index, frame in enumerate(frames[1:], start=2):
        aligned_frame, dx, dy, response = align_translation(
            reference, frame
        )
        response = float(response)

        if not np.isfinite([dx, dy, response]).all():
            raise ValueError(f"Non-finite alignment result for frame {index}.")
        if response < min_alignment_response:
            raise ValueError(
                f"Alignment quality too low for frame {index}: "
                f"response={response:.3f}"
            )

        aligned.append(aligned_frame)
        alignment.append({
            "frame": index,
            "dx_px": round(float(dx), 3),
            "dy_px": round(float(dy), 3),
            "response": round(response, 3),
            "status": "ALIGNED TO FRAME 1",
        })

    transitions = []
    for index in range(2):
        result = detect_moving_candidates(
            aligned[index],
            aligned[index + 1],
            threshold=threshold,
            max_motion_px=max_motion_px,
        )
        transitions.append({
            "from_frame": index + 1,
            "to_frame": index + 2,
            **result,
        })

    # Link detections from both transitions by comparing their middle-frame
    # coordinates. This is a simple nearest-position association baseline.
    tracks = []
    first = transitions[0]["candidates"]
    second = transitions[1]["candidates"]
    used_second = set()

    for candidate_a in first:
        middle_a = candidate_a["to_px"]
        choices = []

        for j, candidate_b in enumerate(second):
            if j in used_second:
                continue
            middle_b = candidate_b["from_px"]
            distance = float(np.hypot(
                middle_a["x"] - middle_b["x"],
                middle_a["y"] - middle_b["y"],
            ))
            if distance <= 3.0:
                choices.append((distance, j, candidate_b))

        if not choices:
            continue

        distance, j, candidate_b = min(choices, key=lambda item: item[0])
        used_second.add(j)

        tracks.append({
            "frame_positions_px": [
                candidate_a["from_px"],
                candidate_a["to_px"],
                candidate_b["to_px"],
            ],
            "step_1_displacement_px": candidate_a["displacement_px"],
            "step_2_displacement_px": candidate_b["displacement_px"],
            "middle_position_match_error_px": round(distance, 2),
            "status": "UNCONFIRMED THREE-FRAME MOVING-OBJECT CANDIDATE",
        })

    return {
        "pipeline": "ASTRA EYE three-frame alignment and tracking baseline",
        "input_files": [str(Path(p)) for p in paths],
        "image_width_px": int(reference.shape[1]),
        "image_height_px": int(reference.shape[0]),
        "alignment": alignment,
        "transitions": transitions,
        "persistent_track_count": len(tracks),
        "tracks": tracks,
        "warning": (
            "Experimental image-processing output only. Tracks are not "
            "confirmed asteroids. Real observations require calibration, "
            "astrometric registration, time-separated exposures, and "
            "independent false-positive checks."
        ),
    }


def main():
    parser = argparse.ArgumentParser(
        description="Align three frames and track moving-object candidates."
    )
    parser.add_argument("frame1")
    parser.add_argument("frame2")
    parser.add_argument("frame3")
    parser.add_argument("--output", default="detection/test_data/three_frame_result.json")
    parser.add_argument("--threshold", type=int, default=25)
    parser.add_argument("--max-motion-px", type=float, default=30)
    args = parser.parse_args()

    result = run_pipeline(
        [args.frame1, args.frame2, args.frame3],
        threshold=args.threshold,
        max_motion_px=args.max_motion_px,
    )

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2), encoding="utf-8")

    print(json.dumps({
        "pipeline": result["pipeline"],
        "image_size_px": [
            result["image_width_px"], result["image_height_px"]
        ],
        "alignment": result["alignment"],
        "candidates_per_transition": [
            t["candidate_count"] for t in result["transitions"]
        ],
        "persistent_track_count": result["persistent_track_count"],
        "tracks": result["tracks"],
        "result_file": str(output),
        "warning": result["warning"],
    }, indent=2))


if __name__ == "__main__":
    main()

