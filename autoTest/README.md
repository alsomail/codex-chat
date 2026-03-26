# autoTest

`autoTest` is the host-side real-device automation scaffold for `REQ-004`.
It is intentionally small and standard-library-first so we can dry-run the flow
even when no Android device is attached.

## What it covers

- Service preflight against `/healthz`
- `adb` device discovery and command construction
- Screenshot, screenrecord, logcat, and UI dump capture plans
- UI-observed event logging, because the app's room/session traces are rendered on screen
- REQ-004 flow orchestration and failure classification
- Pytest-style regression tests

## Layout

```text
autoTest/
  pyproject.toml
  README.md
  configs/req004_real_device.toml
  main.py
  src/autotest/
  tests/
  artifacts/
```

## Quick start

Dry-run the orchestration without a device:

```bash
cd /Users/yuanye/myWork/ChatRoom/autoTest
python3 main.py --dry-run
```

Run the local self-checks:

```bash
cd /Users/yuanye/myWork/ChatRoom/autoTest
python3 main.py --dry-run --json
python3 -m compileall src tests main.py
python3 selfcheck.py
```

If `pytest` is installed:

```bash
cd /Users/yuanye/myWork/ChatRoom/autoTest
python3 -m pytest
```

## Real-device mode

Update `configs/req004_real_device.toml` with the device serial and service URL,
then run:

```bash
cd /Users/yuanye/myWork/ChatRoom/autoTest
python3 main.py --config configs/req004_real_device.toml
```

The current scaffold focuses on preflight, capture plumbing, and explicit
manual checkpoints for the parts that still need stable UI selectors.
