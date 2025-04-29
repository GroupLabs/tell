from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import HTMLResponse, PlainTextResponse
from prometheus_fastapi_instrumentator import Instrumentator
from uuid import uuid4
from typing import Dict
from threading import Lock

# Initialize FastAPI app
app = FastAPI()

# In-memory storage to store uploaded HTML files, protected by a lock
html_storage: Dict[str, str] = {}
storage_lock = Lock()

# Prometheus metrics
Instrumentator().instrument(app).expose(app, include_in_schema=False, endpoint="/metrics")

# Health Check route
@app.get("/", response_class=PlainTextResponse)
async def health_check():
    return "healthy"

# File Upload route
@app.post("/upload")
async def upload_html(file: UploadFile = File(...)):
    if file.content_type != "text/html":
        raise HTTPException(status_code=400, detail="Invalid file type. Only HTML is allowed.")

    # Read file content
    content = await file.read()
    html_data = content.decode("utf-8")

    # Generate UUID for the file
    uuid = str(uuid4())

    # Store the HTML file in memory, ensuring thread safety with a lock
    with storage_lock:
        html_storage[uuid] = html_data

    return PlainTextResponse(f"HTML file uploaded. Access it at: /html/{uuid}")

# Serve HTML by UUID
@app.get("/html/{uuid}", response_class=HTMLResponse)
async def serve_html(uuid: str):
    with storage_lock:
        html_content = html_storage.get(uuid)

    if html_content:
        return HTMLResponse(content=html_content)
    else:
        raise HTTPException(status_code=404, detail="HTML file not found")

# Default 404 route handler
@app.get("/{full_path:path}")
async def not_found():
    raise HTTPException(status_code=404, detail="Not found")
