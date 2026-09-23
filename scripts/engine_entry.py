import multiprocessing
import sys
from app.__main__ import main

if __name__ == "__main__":
    multiprocessing.freeze_support()
    if len(sys.argv) > 1 and sys.argv[1] == "--worker":
        from app.worker import main as worker_main

        worker_main(sys.argv[2:])
    else:
        main()
