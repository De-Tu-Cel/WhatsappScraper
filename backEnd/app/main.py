import sys, os
sys.path.insert(0, os.path.dirname(__file__))  # ← añade backEnd/app/ al path

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes import router
from app.classifier import start_classifier_background


@asynccontextmanager
async def lifespan(app: FastAPI):
    start_classifier_background()
    yield


app = FastAPI(title="Mystery Shopper API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")