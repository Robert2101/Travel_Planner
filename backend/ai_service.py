import os
import json
import logging
from dotenv import load_dotenv
from google import genai
from openai import OpenAI

# Load .env
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), '.env'))

log = logging.getLogger(__name__)

class AIClient:
    def __init__(self):
        self.provider = os.getenv("AI_PROVIDER", "gemini").lower()
        self.gemini_key = os.getenv("GEMINI_API_KEY")
        self.grok_key = os.getenv("GROK_API_KEY")
        self.gemini_model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
        self.grok_model = os.getenv("GROK_MODEL", "grok-4.2-fast")
        
        self.gemini_client = None
        self.grok_client = None
        
        if self.gemini_key:
            self.gemini_client = genai.Client(api_key=self.gemini_key)
            log.info("Gemini client initialized ✓")
            
        if self.grok_key:
            self.grok_client = OpenAI(
                api_key=self.grok_key,
                base_url="https://api.x.ai/v1",
            )
            log.info("Grok (xAI) client initialized ✓")

    def generate_json(self, prompt: str, schema_desc: str = None) -> dict:
        """
        Generates structured JSON output from the active provider.
        """
        if self.provider == "grok" and self.grok_client:
            return self._generate_grok_json(prompt)
        elif self.gemini_client:
            return self._generate_gemini_json(prompt)
        else:
            raise Exception("No active AI client configured")

    def generate_markdown(self, prompt: str) -> str:
        """
        Generates markdown text from the active provider.
        """
        if self.provider == "grok" and self.grok_client:
            return self._generate_grok_text(prompt)
        elif self.gemini_client:
            return self._generate_gemini_text(prompt)
        else:
            raise Exception("No active AI client configured")

    def _generate_gemini_json(self, prompt: str) -> dict:
        try:
            response = self.gemini_client.models.generate_content(
                model=self.gemini_model,
                contents=prompt,
                config={"response_mime_type": "application/json"}
            )
            return json.loads(response.text)
        except Exception as e:
            log.error(f"Gemini JSON error: {e}")
            raise e

    def _generate_gemini_text(self, prompt: str) -> str:
        try:
            response = self.gemini_client.models.generate_content(
                model=self.gemini_model,
                contents=prompt,
            )
            return response.text
        except Exception as e:
            log.error(f"Gemini Text error: {e}")
            raise e

    def _generate_grok_json(self, prompt: str) -> dict:
        try:
            # Grok supports system/user messages
            response = self.grok_client.chat.completions.create(
                model=self.grok_model,
                messages=[
                    {"role": "system", "content": "You are a helpful travel assistant. Always respond in valid JSON."},
                    {"role": "user", "content": prompt},
                ],
                response_format={"type": "json_object"}
            )
            return json.loads(response.choices[0].message.content)
        except Exception as e:
            log.error(f"Grok JSON error: {e}")
            raise e

    def _generate_grok_text(self, prompt: str) -> str:
        try:
            response = self.grok_client.chat.completions.create(
                model=self.grok_model,
                messages=[
                    {"role": "system", "content": "You are a helpful travel assistant for Vijayawada."},
                    {"role": "user", "content": prompt},
                ]
            )
            return response.choices[0].message.content
        except Exception as e:
            log.error(f"Grok Text error: {e}")
            raise e

# Legacy compatibility for gemini_service.py usage
def format_itinerary_with_gemini(summary_json: dict, user_constraints: dict) -> dict:
    client = AIClient()
    prompt = f"""You are an explainable AI travel planner for Vijayawada, Andhra Pradesh.
STRICT RULES:
- Do NOT invent any places, hotels, food spots, or prices.
- Use ONLY the structured data provided below.
- Keep your response focused and well-formatted in Markdown.

YOUR RESPONSE MUST START with a "💡 Why this plan?" section...

USER CONSTRAINTS: {json.dumps(user_constraints)}
ITINERARY DATA: {json.dumps(summary_json)}
"""
    try:
        text = client.generate_markdown(prompt)
        return {"markdown": text}
    except Exception as e:
        return {"markdown": None, "error": str(e)}
