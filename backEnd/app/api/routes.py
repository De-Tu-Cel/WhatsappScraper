from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from app.schemas.company import ProcessUrlRequest, SearchRequest, BatchRequest, DeleteCompaniesRequest, UpdateCompanyRequest
from app.utils import serialize
from app.pipeline import process_url, run_pipeline_batch   # ← app.pipeline
from app.searcher import search_prospects                   # ← app.searcher
from app.database import MongoDBManager

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

@router.get("/companies/meta")
def api_companies_meta():
    try:
        db = MongoDBManager()
        return {
            "industries": db.get_distinct_values("industry"),
            "cities": db.get_distinct_values("city"),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/companies")
def api_list_companies(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    search: Optional[str] = None,
    industry: Optional[str] = None,
    city: Optional[str] = None,
    has_whatsapp: Optional[bool] = None,
):
    try:
        db = MongoDBManager()
        result = db.list_companies(
            page=page,
            page_size=page_size,
            search=search or None,
            industry=industry or None,
            city=city or None,
            has_whatsapp=has_whatsapp,
        )
        return serialize(result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/companies")
def api_delete_companies(req: DeleteCompaniesRequest):
    try:
        db = MongoDBManager()
        deleted = db.delete_companies(req.ids)
        return {"deleted": deleted}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/companies/{company_id}")
def api_update_company(company_id: str, req: UpdateCompanyRequest):
    try:
        db = MongoDBManager()
        fields = {k: v for k, v in req.model_dump().items() if v is not None}
        if not fields:
            raise HTTPException(status_code=400, detail="No fields to update")
        updated = db.update_company_fields(company_id, fields)
        return {"updated": updated}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))