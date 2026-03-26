from __future__ import annotations

from argparse import ArgumentParser
from pathlib import Path
import json

from .adb import AdbClient
from .config import AutoTestConfig, load_config
from .req004_flow import Req004Flow
from .report import render_json, render_markdown, write_report


def _default_config_path() -> Path:
    return Path(__file__).resolve().parents[2] / "configs" / "req004_real_device.toml"


def build_parser() -> ArgumentParser:
    parser = ArgumentParser(prog="chatroom-autotest")
    parser.add_argument("--config", default=str(_default_config_path()), help="Path to the REQ-004 config TOML file.")
    parser.add_argument("--real-device", action="store_true", help="Attempt a real-device run when adb and a device are available.")
    parser.add_argument("--dry-run", action="store_true", help="Force dry-run mode.")
    parser.add_argument("--json", action="store_true", help="Print the report as JSON.")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    config = load_config(args.config)
    artifact_root = Path(__file__).resolve().parents[2]
    adb = AdbClient(
        binary=config.adb.binary,
        serial=config.adb.serial,
        dry_run=args.dry_run,
    )
    flow = Req004Flow(config=config, adb=adb, artifact_root=artifact_root)
    report = flow.run(dry_run=args.dry_run or not args.real_device)
    write_report(report, report.artifact_dir)

    output = render_json(report) if args.json else render_markdown(report)
    print(output, end="")
    return 0
