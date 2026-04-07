import { create } from 'zustand';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export const usePlanStore = create((set, get) => ({
  plans: [],
  loading: false,
  error: null,
  currentResult: null,
  agentStates: null,
  toolCalls: [],
  activeDay: 1,

  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setResult: (result) => set({ currentResult: result, activeDay: 1 }),
  setAgentStates: (states) => set({ agentStates: states }),
  setToolCalls: (calls) => set({ toolCalls:calls }),
  setActiveDay: (day) => set({ activeDay: day }),
  
  setCurrentPlan: (plan) => {
    // Format historical plan to currentResult structure
    const formatted = {
      markdown:  plan.markdown,
      raw_data: {
        metadata:  { ...plan.constraints, actual_days_planned: plan.itinerary.length },
        itinerary: plan.itinerary
      }
    };
    set({ currentResult: formatted, activeDay: 1 });
  },

  fetchPlans: async () => {
    set({ loading: true, error: null });
    try {
      const res = await axios.get(`${API_BASE}/api/plans`);
      set({ plans: res.data, loading: false });
    } catch (err) {
      set({ error: err.response?.data?.detail || 'Failed to fetch plans', loading: false });
    }
  },

  startPlanningStream: async (payload, token) => {
    set({
      loading: true,
      error: '',
      currentResult: null,
      toolCalls: [],
      agentStates: {
        researcher: { status: 'idle' },
        planner:    { status: 'idle' },
        critic:     { status: 'idle' },
        formatter:  { status: 'idle' },
      }
    });

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${API_BASE}/api/plan/stream`, {
        method:  'POST',
        headers,
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

          if (event.type === 'agent_start') {
            set(state => ({
              agentStates: {
                ...state.agentStates,
                [event.agent]: { status: 'running', output: null },
              }
            }));
          } else if (event.type === 'tool_call') {
            set(state => ({
              toolCalls: [...state.toolCalls, { tool: event.tool, result: event.result }]
            }));
          } else if (event.type === 'agent_done') {
            set(state => ({
              agentStates: {
                ...state.agentStates,
                [event.agent]: { status: 'done', output: event.output },
              }
            }));
          } else if (event.type === 'complete') {
            set({ currentResult: event.result, activeDay: 1 });
            // Re-fetch plans to show the newly saved one
            if (token) get().fetchPlans();
          } else if (event.type === 'error') {
            set({ error: event.message });
          }
        }
      }
    } catch (err) {
      set({ error: err.message || 'Stream connection failed' });
    } finally {
      set({ loading: false });
    }
  }
}));
