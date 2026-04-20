import React, { useState, useEffect } from 'react';
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
import { Routes, Route, Link, useNavigate, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/useAuthStore';
import { usePlanStore } from './store/usePlanStore';
import Login from './components/Login';
import Register from './components/Register';
import { LogOut, User, History, Map as MapIcon, Sparkles } from 'lucide-react';

// Fix leaflet's broken default icon paths with bundlers
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl:       markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl:     markerShadow,
});

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

function useLoadingCycle(active, intervalMs = 2500) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    let interval;
    if (active) {
      setStep(0);
      interval = setInterval(() => setStep(s => (s + 1) % LOADING_STEPS.length), intervalMs);
    }
    return () => clearInterval(interval);
  }, [active, intervalMs]);
  return LOADING_STEPS[step];
}

function MainPlanner() {
  const { user, logout, isAuthenticated } = useAuthStore();
  const { 
    loading, error, currentResult, agentStates, toolCalls, 
    activeDay, startPlanningStream, setActiveDay, plans, fetchPlans, setError, setCurrentPlan 
  } = usePlanStore();
  
  const [form, setForm] = useState({ peopleCount: 2, budget: 5000, days: '' });
  const [interests, setInterests] = useState([]);
  const [agentMode, setAgentMode] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const loadingMsg = useLoadingCycle(loading);
  const navigate = useNavigate();

  useEffect(() => {
    if (isAuthenticated) {
      fetchPlans();
    }
  }, [isAuthenticated, fetchPlans]);

  const updateForm = (key, val) => setForm(f => ({ ...f, [key]: val }));
  const toggleInterest = (id) =>
    setInterests(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);

  const handleSubmit = () => {
    if (!isAuthenticated) {
      setError('Please login to generate a travel plan.');
      navigate('/login');
      return;
    }
    const payload = {
      people_count: parseInt(form.peopleCount, 10) || 1,
      budget:       parseFloat(form.budget)         || 1000,
      interests,
      days:         form.days ? parseInt(form.days, 10) : null,
    };
    startPlanningStream(payload, useAuthStore.getState().token);
  };

  const renderMap = () => {
    const itinerary = currentResult?.raw_data?.itinerary;
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

  const renderDayDetail = () => {
    const dayData = currentResult?.raw_data?.itinerary?.find(d => d.day === activeDay);
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

  return (
    <>
      <div className="user-bar">
        {isAuthenticated ? (
          <>
            <div className="user-info">
              <User size={16} />
              <span>{user?.username}</span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button 
                className={`btn-ghost ${showHistory ? 'active-pill' : ''}`} 
                onClick={() => setShowHistory(!showHistory)}
              >
                <History size={16} style={{ marginRight: 8 }} /> History
              </button>
              <button className="btn-ghost" onClick={() => logout()}>
                <LogOut size={16} style={{ marginRight: 8 }} /> Logout
              </button>
            </div>
          </>
        ) : (
          <button className="btn-primary" onClick={() => navigate('/login')} style={{ width: 'auto', padding: '0.4rem 1.5rem' }}>
            Login
          </button>
        )}
      </div>

      {showHistory && isAuthenticated && (
        <div className="history-overlay">
          <div className="glass-panel history-sidebar">
            <div className="history-header">
              <h3><History size={18} /> Saved Plans</h3>
              <button className="btn-close" onClick={() => setShowHistory(false)}>×</button>
            </div>
            <div className="history-list">
              {plans.length === 0 && <p className="empty-msg">No saved plans yet.</p>}
              {plans.map((p) => (
                <div 
                  key={p._id} 
                  className={`history-item ${currentResult?.raw_data?.metadata?.created_at === p.created_at ? 'active' : ''}`}
                  onClick={() => {
                    setCurrentPlan(p);
                    setShowHistory(false);
                  }}
                >
                  <div className="p-date">{new Date(p.created_at).toLocaleDateString()}</div>
                  <div className="p-details">
                    {p.itinerary.length} Days · ₹{p.constraints.budget}/pp
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <header>
        <h1>Vijayawada Travel Planner</h1>
        <p className="subtitle">Exclusively built for Vijayawada, Andhra Pradesh</p>
        <span className="badge">V4 · Multi-Agent Intelligence · MongoDB Persistence</span>
      </header>

      <div className="glass-panel">
        <div className="form-grid">
          <div className="input-group">
            <label>Number of People</label>
            <input type="number" min="1" value={form.peopleCount}
              onChange={e => updateForm('peopleCount', e.target.value)} />
          </div>
          <div className="input-group">
            <label>Budget per Person (₹)</label>
            <input type="number" min="500" step="500" value={form.budget}
              onChange={e => updateForm('budget', e.target.value)} />
          </div>
          <div className="input-group">
            <label>Max Days <span style={{color:'var(--text-dim)', fontSize:'0.75rem'}}>(optional)</span></label>
            <input type="number" min="1" placeholder="Auto-calculate"
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

        <button className="btn-primary" onClick={handleSubmit} disabled={loading}>
          {loading ? 'Processing...' : '✦  Generate Optimal Itinerary'}
        </button>
      </div>

      {error && <div className="error-banner">⚠️ {error}</div>}

      {loading && (
        <div className="glass-panel loading-text">
          <div style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>{loadingMsg}</div>
          <div style={{ width: '100%', height: '3px', background: 'var(--glass-border)', borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: '40%',
              background: 'linear-gradient(90deg, transparent, #FF5A5F, transparent)',
              animation: 'shimmer 1.5s ease-in-out infinite',
            }} />
          </div>
        </div>
      )}

      {agentStates && (
        <div className="glass-panel" style={{ width: '100%' }}>
           <AgentPanel agentStates={agentStates} toolCalls={toolCalls} />
        </div>
      )}

      {currentResult?.raw_data && (() => {
        const meta = currentResult.raw_data.metadata;
        const extraDays = meta.requested_days && meta.requested_days > meta.optimal_days;
        return (
          <>
            {extraDays && (
              <div className="success-banner">
                <strong>📊 Day Optimisation Alert</strong><br />
                Trimmed to <strong>{meta.optimal_days} days</strong> for maximum efficiency.
              </div>
            )}

            {currentResult.markdown ? (
              <div className="glass-panel markdown-content">
                <ReactMarkdown>{currentResult.markdown}</ReactMarkdown>
              </div>
            ) : (
              <div className="glass-panel" style={{ borderColor: '#ffa50233', background: '#ffa5020a' }}>
                <p style={{ margin: 0, color: '#ffa502', fontSize: '0.85rem' }}>
                  ⚠️ Gemini explainability unavailable.
                </p>
              </div>
            )}

            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.75rem' }}>
              <h2 className="results-heading" style={{ margin: 0 }}>Plan for {meta.actual_days_planned} Days</h2>
              <button
                className="btn-primary"
                onClick={() => downloadPDF(currentResult, { people_count: meta.people_count, budget: meta.budget_per_person, interests })}
                style={{ width: 'auto', padding: '0.5rem 1rem', fontSize: '0.8rem', background: 'linear-gradient(135deg, #2ed573, #1abc9c)' }}
              >
                ⬇ Download PDF
              </button>
            </div>

            <div className="day-tabs">
              {currentResult.raw_data.itinerary.map(d => (
                <button key={d.day}
                  className={`tab-btn${d.day === activeDay ? ' active' : ''}`}
                  onClick={() => setActiveDay(d.day)}
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
    </>
  );
}

export default function App() {
  const { isAuthenticated } = useAuthStore();

  return (
    <div className="app-container">
      <Routes>
        <Route path="/" element={<MainPlanner />} />
        <Route 
          path="/login" 
          element={isAuthenticated ? <Navigate to="/" /> : <Login />} 
        />
        <Route 
          path="/register" 
          element={isAuthenticated ? <Navigate to="/" /> : <Register />} 
        />
      </Routes>
    </div>
  );
}
