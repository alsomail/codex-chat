from __future__ import annotations

from pathlib import Path
import re


_TEXT_FIELD_PATTERN = re.compile(r'(?:text|content-desc)="([^"]*)"')


def read_uiautomator_texts(path: str | Path) -> list[str]:
    xml_path = Path(path)
    if not xml_path.exists():
        return []

    xml = xml_path.read_text(encoding="utf-8", errors="replace")
    texts: list[str] = []
    for value in _TEXT_FIELD_PATTERN.findall(xml):
        cleaned = value.strip()
        if cleaned:
            texts.append(cleaned)
    return texts


def build_ui_signal_blob(texts: list[str]) -> str:
    return "\n".join(texts)
