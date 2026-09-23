import json
import multiprocessing
import socket
import sys
import threading
import uvicorn
from app.api import create_app


def main():
    config = json.loads(sys.stdin.readline())
    token = config["token"]
    if len(token) < 32:
        raise ValueError("Invalid session token")
    application = create_app(config["library"], token, config.get("provider"))
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    sock.listen(128)
    server = uvicorn.Server(uvicorn.Config(application, log_level="warning", access_log=False))

    def control():
        for line in sys.stdin:
            if line.strip() == "shutdown":
                break
        server.should_exit = True

    threading.Thread(target=control, daemon=True).start()
    print(json.dumps({"event": "ready", "port": sock.getsockname()[1], "api_version": 1}), flush=True)
    server.run(sockets=[sock])


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
