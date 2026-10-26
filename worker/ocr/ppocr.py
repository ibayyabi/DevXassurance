#!/usr/bin/env python3
"""Local PP-OCRv6 (RapidOCR, ONNX Runtime CPU) helper for the document worker.

One helper process is started per document. It verifies the pinned local model
assets, initializes exactly one engine, and OCRs every image path it is given.
Requests never download models and never fall back to Tesseract.

Setup (one time): ``python worker/ocr/ppocr.py --prefetch`` downloads the pinned
assets and verifies their SHA-256. ``--check`` verifies local assets and pinned
runtime package versions.

Run ``python worker/ocr/ppocr.py --images page-1.png page-2.png`` to OCR files.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import urllib.request
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

# Pinned assets. Keep in sync with worker/ocr/requirements.txt and worker/README.md.
ASSETS = {
    "PP-OCRv6_det_tiny.onnx": {
        "sha256": "f42c0fbd294d95eac1a550e131b277dac97462c8025fa4b6c3cec1b7894bd3d5",
        "url": "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/PP-OCRv6/det/PP-OCRv6_det_tiny.onnx",
    },
    "PP-OCRv6_rec_tiny.onnx": {
        "sha256": "e16e242de5937ad92609223f19bc2aff3727ee40b095f996907c24749bad251b",
        "url": "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/PP-OCRv6/rec/PP-OCRv6_rec_tiny.onnx",
    },
    "ch_ppocr_mobile_v2.0_cls_mobile.onnx": {
        "sha256": "e47acedf663230f8863ff1ab0e64dd2d82b838fceb5957146dab185a89d6215c",
        "url": "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/PP-OCRv4/cls/ch_ppocr_mobile_v2.0_cls_mobile.onnx",
    },
}

ENGINE_NAME = "rapidocr"
MODEL_SIZE = "tiny"
BACKEND = "onnxruntime-cpu"
OCR_ROUTE = "id"


class OcrError(Exception):
    """Explicit OCR failure; never silently returns empty text."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def default_model_dir() -> Path:
    """Directory holding the pinned ONNX files.

    ``XASS_OCR_MODEL_DIR`` wins; otherwise it is the installed RapidOCR
    package ``models`` directory.
    """
    override = os.environ.get("XASS_OCR_MODEL_DIR", "").strip()
    if override:
        return Path(override).expanduser().resolve()
    try:
        import rapidocr  # noqa: F401
    except ModuleNotFoundError as exc:  # pragma: no cover - runtime guard
        raise OcrError(
            "ocr_unavailable",
            "Local PP-OCRv6 runtime is unavailable: install rapidocr and "
            "onnxruntime into the OCR virtualenv (see worker/README.md).",
        ) from exc
    return Path(rapidocr.__file__).resolve().parent / "models"




def verify_assets(model_dir: Path | None = None) -> dict[str, str]:
    """Verify pinned local assets; never downloads.

    Returns the resolved model directory and file paths as a dict.
    """
    directory = model_dir or default_model_dir()
    missing: list[str] = []
    mismatched: list[str] = []
    for name, spec in ASSETS.items():
        path = directory / name
        if not path.is_file():
            missing.append(name)
            continue
        if _sha256(path) != spec["sha256"]:
            mismatched.append(name)

    if missing or mismatched:
        details = []
        if missing:
            details.append(f"missing: {', '.join(missing)}")
        if mismatched:
            details.append(f"checksum mismatch: {', '.join(mismatched)}")
        raise OcrError(
            "ocr_model_unavailable",
            f"Local PP-OCRv6 model assets are not ready in {directory} "
            f"({'; '.join(details)}). Run `python worker/ocr/ppocr.py --prefetch` "
            "once at setup; the worker never downloads models at request time.",
        )

    return {
        "modelDir": str(directory),
        "det": str(directory / "PP-OCRv6_det_tiny.onnx"),
        "rec": str(directory / "PP-OCRv6_rec_tiny.onnx"),
        "cls": str(directory / "ch_ppocr_mobile_v2.0_cls_mobile.onnx"),
    }



def ocr_provenance() -> dict[str, object]:
    try:
        runtime_versions = {
            "rapidocr": version("rapidocr"),
            "onnxruntime": version("onnxruntime"),
        }
    except PackageNotFoundError as exc:
        raise OcrError(
            "ocr_unavailable",
            "Local OCR dependencies are unavailable; install worker/ocr/requirements.txt.",
        ) from exc
    expected_versions = {"rapidocr": "3.10.0", "onnxruntime": "1.31.0"}
    if runtime_versions != expected_versions:
        actual = ", ".join(f"{name}=={value}" for name, value in runtime_versions.items())
        raise OcrError(
            "ocr_unavailable",
            f"Local OCR dependency versions must be {expected_versions}; found {actual}. "
            "Install worker/ocr/requirements.txt.",
        )


    return {
        "runtimeVersions": runtime_versions,
        "modelSha256": {
            "detector": ASSETS["PP-OCRv6_det_tiny.onnx"]["sha256"],
            "recognizer": ASSETS["PP-OCRv6_rec_tiny.onnx"]["sha256"],
            "classifier": ASSETS["ch_ppocr_mobile_v2.0_cls_mobile.onnx"]["sha256"],
        },
    }


def prefetch_assets(model_dir: Path | None = None) -> dict[str, str]:
    """Setup-time download of missing or invalid pinned assets, then verify."""
    directory = model_dir or default_model_dir()
    directory.mkdir(parents=True, exist_ok=True)
    for name, spec in ASSETS.items():
        path = directory / name
        if path.is_file() and _sha256(path) == spec["sha256"]:
            continue
        with urllib.request.urlopen(spec["url"], timeout=300) as response, path.open("wb") as out:
            shutil.copyfileobj(response, out)
        if _sha256(path) != spec["sha256"]:
            path.unlink(missing_ok=True)
            raise OcrError(
                "ocr_model_unavailable",
                f"Downloaded {name} failed SHA-256 verification; the asset was deleted.",
            )
    return verify_assets(directory)


class OcrEngine:
    """One RapidOCR engine for one document's batch of images."""

    def __init__(self, model_dir: Path | None = None) -> None:
        self.assets = verify_assets(model_dir)
        self.route = OCR_ROUTE
        self._engine = None

    def _ensure_engine(self):
        if self._engine is not None:
            return self._engine

        try:
            from rapidocr import (
                EngineType,
                LangCls,
                ModelType,
                OCRVersion,
                RapidOCR,
            )
        except ModuleNotFoundError as exc:  # pragma: no cover - runtime guard
            raise OcrError(
                "ocr_unavailable",
                "Local PP-OCRv6 runtime is unavailable: install rapidocr and "
                "onnxruntime into the OCR virtualenv (see worker/README.md).",
            ) from exc

        params = {
            "Det.engine_type": EngineType.ONNXRUNTIME,
            "Det.lang_type": "id",
            "Det.model_type": ModelType.TINY,
            "Det.ocr_version": OCRVersion.PPOCRV6,
            "Cls.engine_type": EngineType.ONNXRUNTIME,
            "Cls.lang_type": LangCls.CH,
            "Cls.model_type": ModelType.MOBILE,
            "Cls.ocr_version": OCRVersion.PPOCRV4,
            "Rec.engine_type": EngineType.ONNXRUNTIME,
            "Rec.lang_type": "id",
            "Rec.model_type": ModelType.TINY,
            "Rec.ocr_version": OCRVersion.PPOCRV6,
            "EngineConfig.onnxruntime.use_cuda": False,
            "EngineConfig.onnxruntime.use_coreml": False,
            "EngineConfig.onnxruntime.intra_op_num_threads": 1,
            "EngineConfig.onnxruntime.inter_op_num_threads": 1,
            "Global.model_root_dir": self.assets["modelDir"],
            "Global.log_level": "error",
        }
        try:
            self._engine = RapidOCR(params=params)
        except Exception as exc:  # pragma: no cover - runtime guard
            raise OcrError(
                "ocr_failed",
                f"PP-OCRv6 could not start with the local model assets: {exc}",
            ) from exc
        return self._engine

    def recognize(self, image_path: str) -> str:
        engine = self._ensure_engine()
        try:
            result = engine(image_path)
        except Exception as exc:  # pragma: no cover - runtime guard
            raise OcrError(
                "ocr_failed",
                f"PP-OCRv6 could not read image {Path(image_path).name}: {exc}",
            ) from exc
        if result is None or not getattr(result, "txts", None):
            return ""
        return "\n".join(text for text in result.txts if text)

    def recognize_batch(self, image_paths: list[str]) -> list[dict[str, object]]:
        """OCR every image with the single engine; one result per input."""
        results: list[dict[str, object]] = []
        for index, image_path in enumerate(image_paths):
            results.append({"index": index, "text": self.recognize(image_path)})
        return results


def _emit(payload: dict[str, object]) -> None:
    sys.stdout.write(json.dumps(payload))
    sys.stdout.flush()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="verify pinned assets then exit")
    parser.add_argument("--prefetch", action="store_true", help="setup-time: download and verify pinned assets")
    parser.add_argument("--images", nargs="*", default=[], help="image paths to OCR")
    parser.add_argument("--model-dir", default=None, help="override model directory")
    parser.add_argument("--json", action="store_true", help="emit JSON on stdout")
    args = parser.parse_args(argv)

    try:
        model_dir = Path(args.model_dir).expanduser().resolve() if args.model_dir else None

        if args.prefetch:
            assets = prefetch_assets(model_dir)
            if args.json:
                _emit({"ok": True, "engine": ENGINE_NAME, "model": MODEL_SIZE,
                       "backend": BACKEND, "assets": assets})
            else:
                print(f"PP-OCRv6 assets ready in {assets['modelDir']}")
            return 0

        if args.check:
            assets = verify_assets(model_dir)
            provenance = ocr_provenance()
            if args.json:
                _emit({"ok": True, "engine": ENGINE_NAME, "model": MODEL_SIZE,
                       "backend": BACKEND, "route": OCR_ROUTE, **provenance, "assets": assets})
            else:
                print(f"PP-OCRv6 assets OK in {assets['modelDir']}")
            return 0

        image_paths = list(args.images)
        if not image_paths:
            raise OcrError("ocr_failed", "No image paths were supplied to the OCR helper.")

        provenance = ocr_provenance()
        engine = OcrEngine(model_dir=model_dir)
        results = engine.recognize_batch(image_paths)
        if args.json:
            _emit({
                "ok": True,
                "engine": ENGINE_NAME,
                "model": MODEL_SIZE,
                "backend": BACKEND,
                "route": engine.route,
                **provenance,
                "results": results,
            })
        else:
            for entry in results:
                print(entry["text"])
        return 0
    except OcrError as exc:
        if args.json:
            _emit({"ok": False, "errorCode": exc.code, "errorMessage": exc.message})
        else:
            print(f"error [{exc.code}]: {exc.message}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
