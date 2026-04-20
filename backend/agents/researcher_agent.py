"""
ResearcherAgent
───────────────
Role: Given the full place catalogue and user constraints, decide WHICH places
      to include and rank them by user preference. Explain the selection.

Uses: Gemini with structured JSON output (response_mime_type="application/json")
Fallback: if Gemini fails → returns the full filtered list with no reasoning
"""

import json
import logging
import copy
from ai_service import AIClient

log = logging.getLogger(__name__)


def run(client: AIClient, all_places: list, constraints: dict) -> dict:
    """
    Returns:
        {
            selected_ids:    list[str],   # ids of chosen places in priority order
            priority_ids:    list[str],   # subset of selected that strongly match interests
            interest_matches: dict,        # {place_id: reason_str}
            reasoning:       str,          # overall explanation of selection strategy
            fallback_used:   bool
        }
    """
    interests = constraints.get("interests", [])
    budget    = constraints.get("budget", 0)
    people    = constraints.get("people_count", 1)
    days      = constraints.get("days")

    # Always return all places in case Gemini fails
    fallback_ids = [p["id"] for p in all_places]

    if not client:
        log.warning("[RESEARCHER] No Gemini client — using full list")
        return _fallback(all_places)

    catalogue = [
        {"id": p["id"], "name": p["name"], "type": p["type"],
         "avg_time_hours": p["avg_time_hours"],
         "opening_time": p["opening_time"], "closing_time": p["closing_time"]}
        for p in all_places
    ]

    prompt = f"""You are a travel research agent for Vijayawada, Andhra Pradesh.

Your task: Given the user's constraints and the place catalogue, select the most
relevant places for their trip and explain your reasoning.

USER CONSTRAINTS:
- People: {people}
- Budget per person: Rs. {budget}
- Interests: {interests if interests else "No specific preference — include all types"}
- Max days requested: {days if days else "Not specified — you will optimise"}

PLACE CATALOGUE (15 places):
{json.dumps(catalogue, indent=2)}

RULES:
1. Always include ALL places (the planner will trim by time). Just RANK them.
2. Put interest-matched places first in selected_ids.
3. priority_ids = places that STRONGLY match interests (empty list if no interests given).
4. interest_matches = dict mapping place_id to a one-sentence reason.
5. reasoning = 2-3 sentences explaining your overall selection strategy.

Respond with ONLY valid JSON matching this exact schema:
{{
  "selected_ids": ["p1", "p2", ...],
  "priority_ids": ["p1", ...],
  "interest_matches": {{"p1": "reason", ...}},
  "reasoning": "..."
}}"""

    try:
        raw = client.generate_json(prompt)

        # Validate — ensure all ids exist in catalogue
        valid_ids = {p["id"] for p in all_places}
        selected  = [i for i in raw.get("selected_ids", fallback_ids) if i in valid_ids]
        priority  = [i for i in raw.get("priority_ids", [])           if i in valid_ids]

        # Make sure every place is included (researcher ranks, planner trims)
        missing = [i for i in fallback_ids if i not in selected]
        selected += missing

        log.info(f"[RESEARCHER] Selected {len(selected)} places, {len(priority)} priority")
        return {
            "selected_ids":     selected,
            "priority_ids":     priority,
            "interest_matches": raw.get("interest_matches", {}),
            "reasoning":        raw.get("reasoning", ""),
            "fallback_used":    False,
        }

    except Exception as e:
        log.error(f"[RESEARCHER] Gemini failed: {e} — using fallback")
        return _fallback(all_places)


def _fallback(all_places: list) -> dict:
    return {
        "selected_ids":     [p["id"] for p in all_places],
        "priority_ids":     [],
        "interest_matches": {},
        "reasoning":        "Researcher agent unavailable — all places included.",
        "fallback_used":    True,
    }
