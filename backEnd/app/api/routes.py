from fastapi import APIRouter, HTTPException
from app.schemas.company import ProcessUrlRequest, SearchRequest, BatchRequest
from app.utils import serialize
from app.pipeline import process_url, run_pipeline_batch   # ← app.pipeline
from app.searcher import search_prospects                   # ← app.searcher

router = APIRouter()

@router.post("/process-url")
def api_process_url(req: ProcessUrlRequest):
    try:
        return serialize(process_url(req.url))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/search")
def api_search(req: SearchRequest):
    try:
        return {"urls": search_prospects(req.industry, req.city, req.keywords, req.num_results)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/batch")
def api_batch(req: BatchRequest):
    try:
        return serialize(run_pipeline_batch(req.urls))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))