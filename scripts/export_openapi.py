import json
import tempfile
from pathlib import Path
from app.api import create_app

root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as directory:
    application = create_app(directory, "type-generation-session-token-32")
    (root / "frontend" / "api-schema.json").write_text(
        json.dumps(application.openapi(), ensure_ascii=False, indent=2), encoding="utf8"
    )
    application.state.jobs.shutdown()
    application.state.store.close()
