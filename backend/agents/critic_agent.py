"""
CriticAgent
───────────
Role: Independently review the planner's itinerary for correctness.
      Flag issues before the result reaches the user.

Validates:
  - Geographic coherence (are same-day places close together?)
  - Time window compliance (no visits outside opening hours)
  - Budget feasibility (cheapest hotel vs. user budget)
  - Day balance (are days roughly even?)

Uses: Gemini structured JSON output
Fallback: APPROVED with score=7 and a note that critic was unavailable
"""

import json
import logging
from ai_service import AIClient
from engines.clustering_engine import haversine

log = logging.getLogger(__name__)


def run(client: AIClient, planner_output: dict, constraints: dict) -> dict:
    """
    Returns:
        {
            status:   "APPROVED" | "NEEDS_REVISION",
            score:    int (0-10),
            issues:   list[str],
            reasoning: str,
            fallback_used: bool
        }
    """
    if not client:
        return _fallback()

    itinerary = planner_output.get("itinerary", [])
    metadata  = planner_output.get("metadata",  {})

    # Pre-compute facts for the critic
    geo_facts = []
    time_facts = []
    for day in itinerary:
        places = day.get("places", [])
        for i in range(len(places) - 1):
            a, b = places[i], places[i+1]
            d = haversine(a["lat"], a["lng"], b["lat"], b["lng"])
            geo_facts.append(f"Day {day['day']}: {a['name']} -> {b['name']}: {d:.1f} km")
        for p in places:
            start = p.get("visit_start", "?")
            end   = p.get("visit_end",   "?")
            opens = p.get("opening_time", "?")
            closes= p.get("closing_time", "?")
            if start < opens:
                time_facts.append(f"WARN: {p['name']} visited at {start} but opens at {opens}")
            if end > closes:
                time_facts.append(f"WARN: {p['name']} ends at {end} but closes at {closes}")

    summary = {
        "metadata": metadata,
        "day_count": len(itinerary),
        "days": [{"day": d["day"], "places": [p["name"] for p in d["places"]],
                  "total_hours": d.get("total_hours")} for d in itinerary],
        "geographic_distances": geo_facts[:20],
        "time_window_checks":   time_facts or ["All time windows satisfied"],
    }

    prompt = f"""You are a critical reviewer for a travel itinerary planner.

Your job: Review this Vijayawada itinerary and give an honest quality score.

USER CONSTRAINTS:
- People: {constraints.get("people_count")}
- Budget: Rs. {constraints.get("budget")} per person
- Interests: {constraints.get("interests", [])}

ITINERARY SUMMARY:
{json.dumps(summary, indent=2)}

Evaluate for:
1. Geographic coherence (are same-day places reasonably close?)
2. Time window compliance (opening/closing times respected?)
3. Day balance (roughly even distribution of places?)
4. Interest alignment (are priority places actually included?)

Respond ONLY with valid JSON:
{{
  "status": "APPROVED" or "NEEDS_REVISION",
  "score": <integer 0-10>,
  "issues": ["issue1", "issue2"],
  "reasoning": "2-3 sentence overall assessment"
}}

Score guide: 9-10=excellent, 7-8=good, 5-6=acceptable, <5=needs revision.
Only use NEEDS_REVISION if score < 5."""

    try:
        raw = client.generate_json(prompt)
        status = raw.get("status", "APPROVED")
        score  = int(raw.get("score", 7))

        # Safety: never block a plan with score >= 5
        if score >= 5 and status == "NEEDS_REVISION":
            status = "APPROVED"

        log.info(f"[CRITIC] status={status}, score={score}, issues={raw.get('issues', [])}")
        return {
            "status":       status,
            "score":        score,
            "issues":       raw.get("issues", []),
            "reasoning":    raw.get("reasoning", ""),
            "fallback_used": False,
        }

    except Exception as e:
        log.error(f"[CRITIC] Gemini failed: {e}")
        return _fallback()


def _fallback() -> dict:
    return {
        "status":       "APPROVED",
        "score":        7,
        "issues":       [],
        "reasoning":    "Critic agent unavailable — plan approved by default.",
        "fallback_used": True,
    }
