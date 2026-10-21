import cv2
import numpy as np

from moving_object_detector import detect_moving_candidates


def make_star_field():
    image = np.zeros((200, 280), dtype=np.uint8)

    for x, y, radius, brightness in [
        (30, 30, 2, 160),
        (80, 55, 3, 190),
        (140, 100, 2, 220),
        (220, 45, 3, 180),
        (200, 155, 2, 200),
        (55, 165, 3, 170),
    ]:
        cv2.circle(image, (x, y), radius, brightness, -1)

    return image


def align_translation(reference, moving):
    """Estimate global translation and align moving to reference."""
    if reference.shape != moving.shape:
        raise ValueError("Images must have identical dimensions.")

    ref = reference.astype(np.float32)
    mov = moving.astype(np.float32)

    # Estimate how far the moving image is displaced.
    (dx, dy), response = cv2.phaseCorrelate(ref, mov)

    # Shift the moving image back toward the reference frame.
    matrix = np.float32([
        [1, 0, -dx],
        [0, 1, -dy],
    ])

    aligned = cv2.warpAffine(
        moving,
        matrix,
        (moving.shape[1], moving.shape[0]),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=0,
    )

    return aligned, dx, dy, response


def main():
    reference = make_star_field()

    # Simulate a camera shifting right by 3 pixels.
    matrix = np.float32([[1, 0, 3], [0, 1, 0]])
    moving = cv2.warpAffine(
        reference, matrix,
        (reference.shape[1], reference.shape[0]),
    )

    before = detect_moving_candidates(reference, moving)
    print("Before alignment:", before["candidate_count"], "candidates")

    aligned, dx, dy, response = align_translation(reference, moving)

    print(f"Estimated shift: dx={dx:.2f}, dy={dy:.2f} pixels")
    print(f"Phase-correlation response: {response:.3f}")

    after = detect_moving_candidates(reference, aligned)
    print("After alignment:", after["candidate_count"], "candidates")

    folder = __import__("pathlib").Path(__file__).resolve().parent / "test_data"
    folder.mkdir(parents=True, exist_ok=True)

    cv2.imwrite(str(folder / "alignment_reference.png"), reference)
    cv2.imwrite(str(folder / "alignment_shifted.png"), moving)
    cv2.imwrite(str(folder / "alignment_corrected.png"), aligned)

    # This synthetic test expects the 3-pixel shift to be corrected.
    assert abs(dx - 3) < 1.0, "Estimated horizontal shift was inaccurate."
    assert abs(dy) < 1.0, "Unexpected vertical shift."
    assert after["candidate_count"] == 0, (
        "Residual candidates remain after alignment; investigate before integration."
    )

    print("PASS: synthetic translation alignment test.")
    print("This does not validate real astronomical images.")


if __name__ == "__main__":
    main()