import sys, os
sys.path.insert(0, os.path.dirname(__file__))  # ← añade backEnd/app/ al path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes import router

app = FastAPI(title="Lector Comercial API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")