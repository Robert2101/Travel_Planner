# Vijayawada Travel Planner (Multi-Agent System)

An intelligent, real-time travel itinerary planner built specifically for Vijayawada, Andhra Pradesh. This project uses a hybrid architecture that combines heavily deterministic mathematics (physics-based routing, $O(N^2)$ clustering) with an AI multi-agent pipeline powered by Google's Gemini 2.5 Flash model.

## How It Works

The magic of this planner lies in its **Multi-Agent Streaming Pipeline**. When a user requests a trip plan with specific constraints (budget, people, interests, days), the backend delegates the work across a team of specialised agents, streaming their progress live to the frontend.

1. **Researcher Agent (Strategist)**: Reviews your preferences against the full catalog of locations and ranks the best places to visit.
2. **Planner Agent (Mathematical Core)**: A purely deterministic engine that takes the wishlist and maps it to a survivable physics-bound daily schedule. It groups places geographically using the Haversine formula, factors in real-world time windows, and calculates peak/off-peak travel speeds with a 10% chaos buffer.
3. **Critic Agent (QA Reviewer)**: Reviews the mathematically generated itinerary to catch scattered geography, tight schedules, or unbalanced days, assigning it a quality score.
4. **Formatter Agent (Explainable AI)**: Translates the raw data coordinates and routes into a human-readable Markdown report explaining *why* certain routes were chosen.

The frontend is built with **React and Vite**, directly attaching to the backend's Server-Sent Events (SSE) `/api/plan/stream` endpoint to render the Live Agent Pipeline UI.

---

## 🚀 How to Run Locally

### Prerequisites
* **Python 3.9+** (for the FastAPI Backend)
* **Node.js 16+** (for the React/Vite Frontend)
* A **Gemini API Key** (from Google AI Studio)

### 1. Backend Setup

Open a terminal and navigate to the project folder:
```bash
cd Travel_Planner/backend
```

#### Step 1A: Create and Activate a Virtual Environment (venv)

**On macOS and Linux:**
```bash
# Create the virtual environment
python3 -m venv venv

# Activate it
source venv/bin/activate
```

**On Windows:**
```cmd
# Create the virtual environment
python -m venv venv

# Activate it
venv\Scripts\activate
```

*(You will know it is activated when you see `(venv)` at the start of your terminal prompt.)*

#### Step 1B: Install Dependencies
```bash
pip install -r requirements.txt
```

#### Step 1C: Environment Variables
Create a file named `.env` inside the `backend` folder and add your Gemini API Key:
```env
GEMINI_API_KEY=your_google_gemini_api_key_here
```

#### Step 1D: Start the Server
```bash
python app.py
# Or run uvicorn manually:
# uvicorn app:app --host 0.0.0.0 --port 8000 --reload
```
The backend is now running at `http://localhost:8000`.

---

### 2. Frontend Setup

Open a **new** terminal window (keep the backend running in the first one) and navigate to the frontend folder:
```bash
cd Travel_Planner/frontend
```

#### Step 2A: Install Dependencies
```bash
npm install
```

#### Step 2B: Start the Development Server
```bash
npm run dev
```

The frontend will start (usually on `http://localhost:5173`). Open that link in your browser, and the Full-Stack Multi-Agent Travel Planner is ready to use!