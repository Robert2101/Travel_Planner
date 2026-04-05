import os
import json
import logging
from dotenv import load_dotenv
from google import genai

# Load .env so GEMINI_API_KEY is available when running via uvicorn
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '.env'))

log = logging.getLogger(__name__)

api_key = os.getenv("GEMINI_API_KEY")
client  = None

if api_key:
    client = genai.Client(api_key=api_key)
    log.info("Gemini API (google-genai) configured ✓")
else:
    log.warning("GEMINI_API_KEY not found — explainability section will be skipped")


def format_itinerary_with_gemini(summary_json: dict, user_constraints: dict) -> dict:
    """
    Sends a compact itinerary summary to Gemini 2.5 Flash purely for
    explanation and formatting. Returns {"markdown": str | None}.
    """
    if not client:
        log.warning("Skipping Gemini — no API client")
        return {"markdown": None}

    prompt = f"""You are an explainable AI travel planner for Vijayawada, Andhra Pradesh.

STRICT RULES:
- Do NOT invent any places, hotels, food spots, or prices.
- Use ONLY the structured data provided below.
- Keep your response focused and well-formatted in Markdown.

YOUR RESPONSE MUST START with a "💡 Why this plan?" section that explains:
  1. Haversine algorithm was used to group geographically close places, minimising total travel distance.
  2. Dynamic traffic modelling: 15 km/h during peak hours (08:30–10:30, 17:30–20:00), 25 km/h off-peak.
  3. A 10% chaos buffer was added to every travel leg for real-world reliability.
  4. User interests {user_constraints.get("interests", [])} received a scoring bonus in the heuristic.
  5. A second-pass algorithm filled any unused day time with shorter skipped places.

Then present the day-by-day itinerary cleanly, including visit times, transport costs, hotels, and food.

USER CONSTRAINTS:
{json.dumps(user_constraints)}

ITINERARY DATA (GROUND TRUTH):
{json.dumps(summary_json)}
"""

    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
        )
        log.info(f"Gemini response: {len(response.text)} chars")
        return {"markdown": response.text}
    except Exception as e:
        log.error(f"Gemini API error: {e}")
        return {"markdown": None, "error": str(e)}
