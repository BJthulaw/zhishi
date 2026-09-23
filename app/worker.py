"""Explicit worker subprocess entry; no inherited control-channel stdin."""

import sys
from .jobs import parse_worker
from .ocr import render_worker


def main(args=None):
    mode, path, kind, output = args or sys.argv[1:]
    (render_worker if mode == "render" else parse_worker)(path, kind, output)


if __name__ == "__main__":
    main()
