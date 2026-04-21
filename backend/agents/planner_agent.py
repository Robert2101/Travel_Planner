"""
PlannerAgent
────────────
Role: Take the researcher's ranked place list and run the deterministic
      mathematical engines to produce a concrete day-wise itinerary.

This agent does NOT call Gemini. It is the system's mathematical core.
Each engine call is logged as a "tool invocation" — visible in the agent trace.
"""

import copy
import logging
from engines.constraint_engine import calculate_optimal_days
from engines.clustering_engine import cluster_places_by_day
from engines.transport_engine   import calculate_day_routes
from engines.recommendation_engine import get_recommendations

log = logging.getLogger(__name__)


def run(
    all_places:       list,
    researcher_output: dict,
    constraints:      dict,
    affordable_hotels: list,
    food_db:          list,
) -> dict:
    """
    Returns:
        {
            itinerary:   list[day_dict],
            metadata:    dict,
            tool_calls:  list[{tool, input_summary, output_summary}]
        }
    """
    tool_calls = []

    # ── Reorder places by researcher's ranking ────────────────────────────────
    selected_ids = researcher_output.get("selected_ids", [p["id"] for p in all_places])
    id_map       = {p["id"]: p for p in all_places}
    ordered      = [copy.deepcopy(id_map[i]) for i in selected_ids if i in id_map]

    tool_calls.append({
        "tool":           "place_reorder",
        "input_summary":  f"Researcher ranked {len(selected_ids)} place IDs",
        "output_summary": f"Reordered {len(ordered)} places by researcher priority",
    })

    # ── Tool 1: constraint_engine ─────────────────────────────────────────────
    user_days    = constraints.get("days")
    optimal_days = calculate_optimal_days(ordered)
    actual_days  = user_days if user_days else optimal_days

    tool_calls.append({
        "tool":           "constraint_engine.calculate_optimal_days",
        "input_summary":  f"{len(ordered)} places, {sum(p.get('avg_time_hours',2) for p in ordered):.1f}h total",
        "output_summary": f"optimal={optimal_days} days, user_requested={user_days}, planned={actual_days}",
    })

    # ── Tool 2: clustering_engine ─────────────────────────────────────────────
    interests    = constraints.get("interests", [])
    day_clusters = cluster_places_by_day(ordered, actual_days, user_interests=interests, config=constraints)

    tool_calls.append({
        "tool":           "clustering_engine.cluster_places_by_day",
        "input_summary":  f"{len(ordered)} places → {actual_days} days, weights=[dist:1.0, time:0.5, interest:0.5]",
        "output_summary": "; ".join(
            f"Day {d['day']}: {[p['name'] for p in d['places']]}" for d in day_clusters
        ),
    })

    # ── Tool 3: transport_engine ──────────────────────────────────────────────
    for day in day_clusters:
        calculate_day_routes(day, config=constraints)

    route_count = sum(len(d.get("routes", [])) for d in day_clusters)
    tool_calls.append({
        "tool":           "transport_engine.calculate_day_routes",
        "input_summary":  f"Peak-hour aware routing for {actual_days} days",
        "output_summary": f"{route_count} route legs calculated with 10% chaos buffer",
    })

    # ── Tool 4: recommendation_engine ────────────────────────────────────────
    for day in day_clusters:
        get_recommendations(day, affordable_hotels, food_db)

    tool_calls.append({
        "tool":           "recommendation_engine.get_recommendations",
        "input_summary":  f"Haversine proximity match: {len(affordable_hotels)} hotels, {len(food_db)} food spots",
        "output_summary": f"Matched nearby hotels & food for each of {actual_days} days",
    })

    people = constraints.get("people_count", 1)
    budget = constraints.get("budget", 0)

    return {
        "itinerary": day_clusters,
        "metadata":  {
            "optimal_days":       optimal_days,
            "actual_days_planned": actual_days,
            "requested_days":     user_days,
            "people_count":       people,
            "budget_per_person":  budget,
            "message": (
                "Relaxed Schedule: Places spaced out over requested days."
                if user_days and user_days > optimal_days
                else "Optimal plan generated."
            ),
        },
        "tool_calls": tool_calls,
    }
