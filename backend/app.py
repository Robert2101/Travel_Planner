from dotenv import load_dotenv
load_dotenv(dotenv_path=__import__('os').path.join(__import__('os').path.dirname(__file__), '.env'))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import List, Optional
import json, os, copy, logging, asyncio

from engines.constraint_engine import calculate_optimal_days, filter_places
from engines.clustering_engine import cluster_places_by_day
from engines.transport_engine import calculate_day_routes
from engines.recommendation_engine import get_recommendations
from gemini_service import format_itinerary_with_gemini, client as gemini_client

from agents import researcher_agent, planner_agent, critic_agent

logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(message)s")
log = logging.getLogger(__name__)

app = FastAPI(title="Vijayawada Travel Planner API v4 — Multi-Agent")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Load ground truth DB once ──────────────────────────────────────────────────
DB_PATH = os.path.join(os.path.dirname(__file__), 'data', 'vijayawada_data.json')
try:
    with open(DB_PATH, 'r', encoding='utf-8') as f:
        DB = json.load(f)
    log.info(f"DB loaded: {len(DB['places'])} places, {len(DB['hotels'])} hotels, {len(DB['food'])} food spots")
except FileNotFoundError:
    DB = {"places": [], "hotels": [], "food": []}
    log.error("vijayawada_data.json NOT FOUND")


# ── Request model ──────────────────────────────────────────────────────────────
class PlanRequest(BaseModel):
    people_count: int   = Field(gt=0)
    budget:       float = Field(gt=0)
    interests:    List[str] = []
    days:         Optional[int] = Field(default=None, gt=0)


# ── SSE helper ────────────────────────────────────────────────────────────────
def sse(event_type: str, **kwargs) -> str:
    payload = {"type": event_type, **kwargs}
    return f"data: {json.dumps(payload)}\n\n"


# ── Shared budget helper ───────────────────────────────────────────────────────
def _filter_hotels_by_budget(hotels, max_price_per_night):
    affordable = []
    for h in hotels:
        try:
            high = int(h["price_range"].replace("₹","").replace(",","").split("–")[1].strip())
            if high <= max_price_per_night:
                affordable.append(h)
        except Exception:
            affordable.append(h)
    return affordable if affordable else hotels


# ══════════════════════════════════════════════════════════════════════════════
# ENDPOINT 1 — Multi-Agent SSE Stream  (NEW)
# ══════════════════════════════════════════════════════════════════════════════
@app.post("/api/plan/stream")
async def plan_trip_stream(req: PlanRequest):
    """
    SSE endpoint. Yields agent events in real-time so the frontend can
    display the agent activity panel as each agent completes its work.
    """
    constraints = req.model_dump()

    async def event_generator():
        # ── Pre-run: filter + budget ──────────────────────────────────────────
        filtered_raw = filter_places(DB['places'], interests=req.interests)
        if not filtered_raw:
            yield sse("error", message="No places match your interests.")
            return

        all_places = copy.deepcopy(filtered_raw)
        group_budget      = req.budget * req.people_count
        budget_per_night  = group_budget * 0.4
        affordable_hotels = _filter_hotels_by_budget(DB['hotels'], budget_per_night)

        # ── AGENT 1: Researcher ───────────────────────────────────────────────
        yield sse("agent_start", agent="researcher",
                  message=f"Analysing {len(all_places)} places for your interests...")
        await asyncio.sleep(0)   # allow flush

        researcher_out = researcher_agent.run(gemini_client, all_places, constraints)
        yield sse("agent_done", agent="researcher", output={
            "priority_count":  len(researcher_out["priority_ids"]),
            "reasoning":       researcher_out["reasoning"],
            "interest_matches": researcher_out["interest_matches"],
            "fallback_used":   researcher_out["fallback_used"],
        })

        # ── AGENT 2: Planner ──────────────────────────────────────────────────
        yield sse("agent_start", agent="planner",
                  message="Running 4 deterministic engine tools...")
        await asyncio.sleep(0)

        planner_out = planner_agent.run(
            all_places, researcher_out, constraints,
            affordable_hotels, DB['food']
        )

        # Emit individual tool call events
        for tc in planner_out["tool_calls"]:
            yield sse("tool_call", agent="planner",
                      tool=tc["tool"], result=tc["output_summary"])
            await asyncio.sleep(0)

        yield sse("agent_done", agent="planner", output={
            "days_built":  planner_out["metadata"]["actual_days_planned"],
            "tool_count":  len(planner_out["tool_calls"]),
        })

        # ── AGENT 3: Critic ───────────────────────────────────────────────────
        yield sse("agent_start", agent="critic",
                  message="Validating plan quality and coherence...")
        await asyncio.sleep(0)

        critic_out = critic_agent.run(gemini_client, planner_out, constraints)
        yield sse("agent_done", agent="critic", output={
            "status":       critic_out["status"],
            "score":        critic_out["score"],
            "issues":       critic_out["issues"],
            "reasoning":    critic_out["reasoning"],
            "fallback_used": critic_out["fallback_used"],
        })

        # ── AGENT 4: Formatter ────────────────────────────────────────────────
        yield sse("agent_start", agent="formatter",
                  message="Writing explainability report with Gemini 2.5 Flash...")
        await asyncio.sleep(0)

        pipeline_result = {
            "metadata":  planner_out["metadata"],
            "itinerary": planner_out["itinerary"],
        }

        compact = {
            "metadata": pipeline_result["metadata"],
            "itinerary": [
                {"day": d["day"], "total_hours": d["total_hours"],
                 "places": [{"name": p["name"], "visit_start": p.get("visit_start"),
                              "visit_end": p.get("visit_end"), "type": p["type"]}
                             for p in d["places"]],
                 "routes": d.get("routes", []),
                 "recommendations": d.get("recommendations", {})}
                for d in pipeline_result["itinerary"]
            ],
        }

        gemini_result = format_itinerary_with_gemini(compact, constraints)
        yield sse("agent_done", agent="formatter", output={
            "markdown_length": len(gemini_result.get("markdown") or ""),
        })

        # ── Final complete event ───────────────────────────────────────────────
        yield sse("complete", result={
            "markdown":    gemini_result.get("markdown"),
            "raw_data":    pipeline_result,
            "agent_trace": {
                "researcher": researcher_out,
                "planner":    {"tool_calls": planner_out["tool_calls"]},
                "critic":     critic_out,
            },
        })

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":               "no-cache",
            "X-Accel-Buffering":           "no",
            "Access-Control-Allow-Origin": "*",
        },
    )


# ══════════════════════════════════════════════════════════════════════════════
# ENDPOINT 2 — Original pipeline (kept for compatibility / PDF download)
# ══════════════════════════════════════════════════════════════════════════════
@app.post("/api/plan")
async def plan_trip(req: PlanRequest):
    log.info(f"[REQUEST] people={req.people_count}, budget={req.budget}, "
             f"interests={req.interests}, days={req.days}")

    filtered_raw = filter_places(DB['places'], interests=req.interests)
    if not filtered_raw:
        raise HTTPException(status_code=404, detail="No places match your interests.")

    filtered          = copy.deepcopy(filtered_raw)
    optimal_days      = calculate_optimal_days(filtered)
    user_days         = req.days or optimal_days
    actual_days       = min(optimal_days, user_days)
    group_budget      = req.budget * req.people_count
    budget_per_night  = group_budget * 0.4
    affordable_hotels = _filter_hotels_by_budget(DB['hotels'], budget_per_night)

    day_clusters = cluster_places_by_day(filtered, actual_days, user_interests=req.interests)
    final_itinerary = []
    for day in day_clusters:
        calculate_day_routes(day)
        get_recommendations(day, affordable_hotels, DB['food'])
        final_itinerary.append(day)

    pipeline_result = {
        "metadata": {
            "requested_days": req.days, "optimal_days": optimal_days,
            "actual_days_planned": actual_days, "people_count": req.people_count,
            "budget_per_person": req.budget,
            "message": "Optimized: extra days removed." if req.days and req.days > optimal_days else "Optimal plan generated.",
        },
        "itinerary": final_itinerary,
    }

    compact = {
        "metadata": pipeline_result["metadata"],
        "itinerary": [
            {"day": d["day"], "total_hours": d["total_hours"],
             "places": [{"name": p["name"], "visit_start": p.get("visit_start"),
                          "visit_end": p.get("visit_end"), "type": p["type"]} for p in d["places"]],
             "routes": d.get("routes", []), "recommendations": d.get("recommendations", {})}
            for d in final_itinerary
        ],
    }

    gemini_result = format_itinerary_with_gemini(compact, req.model_dump())
    return {
        "markdown": gemini_result.get("markdown"),
        "raw_data": pipeline_result,
    }


@app.get("/health")
def health():
    return {"status": "ok", "db_places": len(DB.get("places", []))}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
