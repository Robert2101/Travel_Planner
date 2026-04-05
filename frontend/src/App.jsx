import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon   from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import './App.css';
import { downloadPDF } from './generatePDF';
import AgentPanel from './AgentPanel';

// Fix leaflet's broken default icon paths with bundlers
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl:       markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl:     markerShadow,
});

// ── BUG FIX: use env variable, never hardcode ─────────────────────────────
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';
console.log('[CONFIG] API_BASE =', API_BASE);

const INTEREST_OPTIONS = [
  { id: 'temple',   label: '🛕 Temple' },
  { id: 'heritage', label: '🏛️ Heritage' },
  { id: 'nature',   label: '🌿 Nature' },
  { id: 'landmark', label: '📍 Landmark' },
  { id: 'shopping', label: '🛍️ Shopping' },
];

const LOADING_STEPS = [
  '🗺️  Filtering places by your interests…',
  '📐  Running Haversine distance calculations…',
  '🚦  Evaluating peak-hour traffic speeds…',
  '⚖️  Scoring heuristic: distance · time · interest…',
  '📦  Second-pass: filling unused day slots…',
  '🏨  Matching nearby hotels by proximity…',
  '🍽️  Finding food spots within 2.5 km…',
  '✍️  Gemini formatting the itinerary…',
];

const DAY_COLORS = ['#FF5A5F', '#2ed573', '#ffa502', '#1e90ff', '#a29bfe'];

/** Cycles through LOADING_STEPS every intervalMs while active */
function useLoadingCycle(active, intervalMs = 2500) {
  const [step, setStep] = useState(0);
  const ref = useRef(null);
  useEffect(() => {
    if (active) {
      setStep(0);
      ref.current = setInterval(() => setStep(s => (s + 1) % LOADING_STEPS.length), intervalMs);
    } else {
      clearInterval(ref.current);
    }
    return () => clearInterval(ref.current);
  }, [active, intervalMs]);
  return LOADING_STEPS[step];
}

export default function App() {
  const [form, setForm]           = useState({ peopleCount: 2, budget: 5000, days: '' });
  const [interests, setInterests]  = useState([]);
  const [loading, setLoading]      = useState(false);
  const [error, setError]          = useState('');
  const [result, setResult]        = useState(null);
  const [activeDay, setActiveDay]  = useState(1);
  const [agentMode, setAgentMode]  = useState(true);   // default: multi-agent
  const [agentStates, setAgentStates] = useState(null); // {researcher:{status,output}, ...}
  const [toolCalls, setToolCalls]  = useState([]);
  const loadingMsg                 = useLoadingCycle(loading && !agentMode);

  const updateForm = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const toggleInterest = (id) =>
    setInterests(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);

  // ── Multi-Agent SSE Stream ────────────────────────────────────────────────
  const handleStreamSubmit = async () => {
    console.group('[AGENT-STREAM] Starting multi-agent pipeline');
    setLoading(true);
    setError('');
    setResult(null);
    setToolCalls([]);
    setAgentStates({
      researcher: { status: 'idle' },
      planner:    { status: 'idle' },
      critic:     { status: 'idle' },
      formatter:  { status: 'idle' },
    });

    const payload = {
      people_count: parseInt(form.peopleCount, 10) || 1,
      budget:       parseFloat(form.budget)         || 1000,
      interests,
      days:         form.days ? parseInt(form.days, 10) : null,
    };
    console.log('[PAYLOAD]', payload);

    try {
      const res = await fetch(`${API_BASE}/api/plan/stream`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });

      const reader = res.body.getReader();
      const dec    = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });

        const lines = buf.split('\n\n');
        buf = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const event = JSON.parse(line.slice(6));
          console.log('[SSE]', event);

          if (event.type === 'agent_start') {
            setAgentStates(prev => ({
              ...prev,
              [event.agent]: { status: 'running', output: null },
            }));
          } else if (event.type === 'tool_call') {
            setToolCalls(prev => [...prev, { tool: event.tool, result: event.result }]);
          } else if (event.type === 'agent_done') {
            setAgentStates(prev => ({
              ...prev,
              [event.agent]: { status: 'done', output: event.output },
            }));
          } else if (event.type === 'complete') {
            console.log('[COMPLETE] result =', event.result);
            setResult(event.result);
            setActiveDay(1);
          } else if (event.type === 'error') {
            setError(event.message);
          }
        }
      }
    } catch (err) {
      console.error('[STREAM ERROR]', err);
      setError(err.message || 'Stream connection failed');
    } finally {
      setLoading(false);
      console.groupEnd();
    }
  };

  const handleSubmit = agentMode ? handleStreamSubmit : handleLegacySubmit;

  // ── Legacy single-request submit (non-agent mode) ─────────────────────────
  async function handleLegacySubmit() {
    console.group('[SUBMIT] User clicked Generate');

    const payload = {
      people_count: parseInt(form.peopleCount, 10) || 1,
      budget:       parseFloat(form.budget)         || 1000,
      interests,
      days:         form.days ? parseInt(form.days, 10) : null,
    };

    console.log('[PAYLOAD]', payload);

    if (payload.people_count < 1) {
      console.warn('[VALIDATION] people_count must be ≥ 1');
      setError('Number of people must be at least 1.');
      console.groupEnd();
      return;
    }
    if (payload.budget < 1) {
      console.warn('[VALIDATION] budget must be > 0');
      setError('Budget must be greater than ₹0.');
      console.groupEnd();
      return;
    }

    setLoading(true);
    setError('');
    setResult(null);

    try {
      const url = `${API_BASE}/api/plan`;
      console.log('[REQUEST] POST', url);
      const t0  = performance.now();

      const res = await axios.post(url, payload, { timeout: 30000 });

      const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
      console.log(`[RESPONSE] ${res.status} in ${elapsed}s`, res.data);

      if (!res.data?.raw_data) {
        console.error('[ERROR] raw_data missing from response', res.data);
        throw new Error('Server returned unexpected structure');
      }

      setResult(res.data);
      setActiveDay(1);
      console.log('[ITINERARY] days =', res.data.raw_data.itinerary.length);
    } catch (err) {
      const msg = err.response?.data?.detail || err.message || 'Unknown error';
      console.error('[CAUGHT ERROR]', err);
      console.error('[ERROR MSG]', msg);
      setError(msg);
    } finally {
      setLoading(false);
      console.groupEnd();
    }
  }

  // ── Map ───────────────────────────────────────────────────────────────────
  const renderMap = () => {
    const itinerary = result?.raw_data?.itinerary;
    if (!itinerary) return null;
    const dayData = itinerary.find(d => d.day === activeDay);
    if (!dayData?.places?.length) return null;

    const positions = dayData.places.map(p => [p.lat, p.lng]);
    const color     = DAY_COLORS[(activeDay - 1) % DAY_COLORS.length];

    return (
      <div className="glass-panel map-wrapper">
        <h3>Optimised Route — Day {activeDay}</h3>
        <div style={{ height: 380, borderRadius: 10, overflow: 'hidden' }}>
          <MapContainer center={positions[0]} zoom={13} style={{ height: '100%', width: '100%' }}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {dayData.places.map((place, idx) => (
              <Marker key={place.id} position={[place.lat, place.lng]}>
                <Popup>
                  <strong>Stop {idx + 1}: {place.name}</strong><br />
                  {place.visit_start} → {place.visit_end}<br />
                  <em>{place.avg_time_hours}h visit</em>
                </Popup>
              </Marker>
            ))}
            {positions.length > 1 && (
              <Polyline positions={positions} color={color} weight={4} opacity={0.85} dashArray="8 6" />
            )}
          </MapContainer>
        </div>
      </div>
    );
  };

  // ── Day detail ────────────────────────────────────────────────────────────
  const renderDayDetail = () => {
    const dayData = result?.raw_data?.itinerary?.find(d => d.day === activeDay);
    if (!dayData) return null;

    return (
      <div className="glass-panel day-card">
        <p className="day-header">Day {dayData.day} — {dayData.total_hours}h itinerary</p>

        {dayData.places.map((place, idx) => (
          <div className="place-item" key={place.id}>
            <div className="place-num">{idx + 1}</div>
            <div className="place-info">
              <p className="place-name">{place.name}</p>
              <span className="place-type">{place.type}</span>
              <p className="place-meta">
                🕐 <span>{place.visit_start} – {place.visit_end}</span>
                &nbsp;|&nbsp;
                ⏱ <span>{place.avg_time_hours}h visit</span>
                &nbsp;|&nbsp;
                🏛 Opens <span>{place.opening_time}</span>, Closes <span>{place.closing_time}</span>
              </p>
            </div>
          </div>
        ))}

        <div className="two-col">
          {dayData.routes?.length > 0 && (
            <div className="sub-card">
              <h4>Traffic-Aware Transport</h4>
              {dayData.routes.map((r, i) => (
                <div className="route-item" key={i}>
                  <div className="route-header">
                    {r.from} <span style={{color:'var(--text-dim)'}}>→</span> {r.to}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
                    {r.distance_km} km &nbsp;·&nbsp; ~{r.costs.mins} min drive
                  </div>
                  <div className="cost-pills">
                    <span className="pill">🚕 Auto ₹{r.costs.auto}</span>
                    <span className="pill">🚙 Uber ₹{r.costs.cab}</span>
                    <span className="pill">🏍 Rapido ₹{r.costs.bike}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {dayData.recommendations && (
            <div className="sub-card">
              <h4>Nearby Hotels</h4>
              <ul className="rec-list">
                {dayData.recommendations.hotels?.map((h, i) => (
                  <li key={i}><strong>{h.name}</strong><br />{h.price_range}</li>
                ))}
              </ul>
              <br />
              <h4>Best Food Spots</h4>
              <ul className="rec-list">
                {dayData.recommendations.food?.map((f, i) => (
                  <li key={i}><strong>{f.name}</strong><br />{f.type}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="app-container">
      <header>
        <h1>Vijayawada Travel Planner</h1>
        <p className="subtitle">Exclusively built for Vijayawada, Andhra Pradesh</p>
        <span className="badge">V3 · Heuristic Spatio-Temporal Clustering · O(n²)</span>
      </header>

      {/* Form */}
      <div className="glass-panel">
        <div className="form-grid">
          <div className="input-group">
            <label>Number of People</label>
            <input id="inp-people" type="number" min="1" value={form.peopleCount}
              onChange={e => updateForm('peopleCount', e.target.value)} />
          </div>
          <div className="input-group">
            <label>Budget per Person (₹)</label>
            <input id="inp-budget" type="number" min="500" step="500" value={form.budget}
              onChange={e => updateForm('budget', e.target.value)} />
          </div>
          <div className="input-group">
            <label>Max Days <span style={{color:'var(--text-dim)', fontSize:'0.75rem'}}>(optional)</span></label>
            <input id="inp-days" type="number" min="1" placeholder="Leave blank to auto-calculate"
              value={form.days} onChange={e => updateForm('days', e.target.value)} />
          </div>
          <div className="input-group">
            <label>Interests</label>
            <div className="interest-chips">
              {INTEREST_OPTIONS.map(opt => (
                <div key={opt.id}
                  className={`chip${interests.includes(opt.id) ? ' active' : ''}`}
                  onClick={() => toggleInterest(opt.id)}
                >
                  {opt.label}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button id="btn-generate" className="btn-primary" onClick={handleSubmit} disabled={loading}
            style={{ flex: 1 }}>
            {loading
              ? (agentMode ? 'Agents running…' : 'Running O(n²) Engine…')
              : '✦  Generate Optimal Itinerary'}
          </button>
          <button
            id="btn-agent-mode"
            onClick={() => setAgentMode(m => !m)}
            disabled={loading}
            title={agentMode ? 'Switch to simple mode' : 'Switch to multi-agent mode'}
            style={{
              padding: '0 1rem', borderRadius: '10px', border: '1px solid',
              borderColor: agentMode ? 'rgba(162,155,254,0.5)' : 'var(--glass-border)',
              background: agentMode ? 'rgba(162,155,254,0.1)' : 'transparent',
              color: agentMode ? '#a29bfe' : 'var(--text-secondary)',
              fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
              fontFamily: 'inherit', whiteSpace: 'nowrap',
              transition: 'all 0.2s',
            }}
          >
            {agentMode ? '🤖 Agent Mode' : '⚡ Simple Mode'}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && <div className="error-banner">⚠️ {error}</div>}

      {/* Loading */}
      {loading && (
        <div className="glass-panel loading-text">
          <div style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>{loadingMsg}</div>
          <div style={{ width: '100%', height: '3px', background: 'var(--glass-border)', borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: '40%',
              background: 'linear-gradient(90deg, transparent, #FF5A5F, transparent)',
              animation: 'shimmer 1.5s ease-in-out infinite',
            }} />
          </div>
        </div>
      )}

      {/* Results */}
      {result?.raw_data && (() => {
        const meta           = result.raw_data.metadata;
        const extraDays      = meta.requested_days && meta.requested_days > meta.optimal_days;
        const pdfConstraints = {
          people_count: meta.people_count     || 1,
          budget:       meta.budget_per_person || 0,
          interests:    interests,   // from component state
        };
        return (
          <>
            {/* Agent Activity Panel */}
            {agentMode && agentStates && (
              <div className="glass-panel" style={{ marginBottom: '1.5rem' }}>
                <AgentPanel agentStates={agentStates} toolCalls={toolCalls} />
              </div>
            )}

            {extraDays && (
              <div className="success-banner">
                <strong>📊 Day Optimisation Alert</strong><br />
                You requested <strong>{meta.requested_days} days</strong> — the constraint engine
                computed only <strong>{meta.optimal_days} days</strong> are needed. Plan trimmed to
                avoid wasting your time.
              </div>
            )}

            {result.markdown ? (
              <div className="glass-panel markdown-content">
                <ReactMarkdown>{result.markdown}</ReactMarkdown>
              </div>
            ) : (
              <div className="glass-panel" style={{ borderColor: 'rgba(255,165,0,0.3)', background: 'rgba(255,165,0,0.04)' }}>
                <p style={{ margin: 0, color: '#ffa502', fontSize: '0.85rem' }}>
                  ⚠️ <strong>Gemini explainability unavailable</strong> — deterministic pipeline data is shown below.
                  Check that <code>GEMINI_API_KEY</code> is set in <code>backend/.env</code>.
                </p>
              </div>
            )}

            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.75rem' }}>
              <h2 className="results-heading" style={{ margin: 0 }}>Pipeline Data — Day-by-Day</h2>
              <button
                id="btn-download-pdf"
                onClick={() => {
                  console.log('[PDF] Generating with constraints:', pdfConstraints);
                  downloadPDF(result, pdfConstraints);
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  background: 'linear-gradient(135deg, #2ed573, #1abc9c)',
                  color: '#fff', border: 'none', borderRadius: '8px',
                  padding: '0.55rem 1.1rem', fontSize: '0.85rem',
                  fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  boxShadow: '0 4px 12px rgba(46,213,115,0.3)',
                  transition: 'opacity 0.2s, transform 0.1s',
                }}
                onMouseEnter={e => e.target.style.opacity = 0.9}
                onMouseLeave={e => e.target.style.opacity = 1}
              >
                ⬇ Download PDF
              </button>
            </div>

            <div className="day-tabs">
              {result.raw_data.itinerary.map(d => (
                <button key={d.day}
                  className={`tab-btn${d.day === activeDay ? ' active' : ''}`}
                  onClick={() => { console.log('[TAB] switched to day', d.day); setActiveDay(d.day); }}
                >
                  Day {d.day}
                </button>
              ))}
            </div>

            {renderMap()}
            {renderDayDetail()}
          </>
        );
      })()}
    </div>
  );
}
