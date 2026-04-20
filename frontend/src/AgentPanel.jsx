import React from 'react';

const AGENTS = [
  {
    id:       'researcher',
    label:    'Researcher Agent',
    icon:     '🔍',
    subtitle: 'Gemini JSON · Ranks & selects places by interest',
    color:    '#a29bfe',
  },
  {
    id:       'planner',
    label:    'Planner Agent',
    icon:     '🧮',
    subtitle: 'Deterministic Python · Haversine clustering + routing',
    color:    '#2ed573',
  },
  {
    id:       'critic',
    label:    'Critic Agent',
    icon:     '⚖️',
    subtitle: 'Gemini JSON · Validates geo, time windows, balance',
    color:    '#ffa502',
  },
  {
    id:       'formatter',
    label:    'Formatter Agent',
    icon:     '✍️',
    subtitle: 'Gemini Text · Writes explainability markdown',
    color:    '#FF5A5F',
  },
];

function StatusBadge({ status }) {
  const styles = {
    idle:    { bg: 'rgba(255,255,255,0.06)', color: '#555565', label: 'Idle' },
    running: { bg: 'rgba(255,165,30,0.15)',  color: '#ffa502', label: 'Running…' },
    done:    { bg: 'rgba(46,213,115,0.15)',  color: '#2ed573', label: 'Done' },
    error:   { bg: 'rgba(255,90,95,0.15)',   color: '#FF5A5F', label: 'Error' },
  };
  const s = styles[status] || styles.idle;
  return (
    <span style={{
      padding: '2px 10px', borderRadius: '100px', fontSize: '0.72rem',
      fontWeight: 600, background: s.bg, color: s.color,
      display: 'inline-flex', alignItems: 'center', gap: 5,
    }}>
      {status === 'running' && (
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ffa502',
          animation: 'pulse 1s ease-in-out infinite', display: 'inline-block' }} />
      )}
      {s.label}
    </span>
  );
}

function ToolCallRow({ tc }) {
  return (
    <div style={{ fontSize: '0.76rem', padding: '4px 8px', margin: '3px 0',
      background: 'rgba(46,213,115,0.06)', borderRadius: 4, borderLeft: '2px solid #2ed573',
      wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
      <span style={{ color: '#2ed573', fontWeight: 600 }}>{tc.tool}</span>
      <br />
      <span style={{ color: '#8a8a9a' }}>{tc.result}</span>
    </div>
  );
}

function AgentCard({ agent, agentState, toolCalls }) {
  const { status = 'idle', output = null } = agentState || {};
  const isRunning = status === 'running';

  return (
    <div style={{
      background: isRunning
        ? `linear-gradient(135deg, rgba(255,165,30,0.06), rgba(0,0,0,0))`
        : 'rgba(255,255,255,0.03)',
      border: `1px solid ${isRunning ? 'rgba(255,165,30,0.3)' : status === 'done' ? `${agent.color}33` : 'rgba(255,255,255,0.07)'}`,
      borderRadius: 10, padding: '1rem',
      transition: 'all 0.3s ease',
      opacity: status === 'idle' ? 0.5 : 1,
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
      wordBreak: 'break-word', overflowWrap: 'anywhere'
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
        <div>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: agent.color, marginBottom: 2 }}>
            {agent.icon} {agent.label}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#555565' }}>{agent.subtitle}</div>
        </div>
        <StatusBadge status={status} />
      </div>

      {/* Running message */}
      {isRunning && (
        <div style={{ fontSize: '0.8rem', color: '#ffa502', marginTop: 6 }}>
          Processing…
        </div>
      )}

      {/* Tool calls (Planner only) */}
      {toolCalls?.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {toolCalls.map((tc, i) => <ToolCallRow key={i} tc={tc} />)}
        </div>
      )}

      {/* Output */}
      {status === 'done' && output && (
        <div style={{ marginTop: 8, fontSize: '0.8rem', color: '#8a8a9a', lineHeight: 1.6 }}>
          {agent.id === 'researcher' && (
            <>
              <div><strong style={{color:'#f0f0f5'}}>Priority places:</strong> {output.priority_count}</div>
              {output.reasoning && <div style={{marginTop:4, fontStyle:'italic'}}>"{output.reasoning}"</div>}
              {output.fallback_used && <div style={{color:'#ffa502', marginTop:4}}>⚠ Fallback used (Gemini unavailable)</div>}
            </>
          )}
          {agent.id === 'planner' && (
            <div><strong style={{color:'#f0f0f5'}}>Built:</strong> {output.days_built} days — {output.tool_count} tools executed</div>
          )}
          {agent.id === 'critic' && (
            <>
              <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:4 }}>
                <span style={{
                  background: output.status === 'APPROVED' ? 'rgba(46,213,115,0.15)' : 'rgba(255,90,95,0.15)',
                  color: output.status === 'APPROVED' ? '#2ed573' : '#FF5A5F',
                  padding: '2px 10px', borderRadius: 4, fontWeight: 700, fontSize: '0.78rem',
                }}>{output.status}</span>
                <span style={{ color: '#f0f0f5', fontWeight: 700 }}>Score: {output.score}/10</span>
              </div>
              {output.reasoning && <div style={{fontStyle:'italic'}}>"{output.reasoning}"</div>}
              {output.issues?.length > 0 && (
                <div style={{ marginTop:4, color:'#ffa502' }}>
                  Issues: {output.issues.join(' · ')}
                </div>
              )}
              {output.fallback_used && <div style={{color:'#ffa502', marginTop:4}}>⚠ Fallback used</div>}
            </>
          )}
          {agent.id === 'formatter' && (
            <div><strong style={{color:'#f0f0f5'}}>Markdown:</strong> {output.markdown_length} characters generated</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AgentPanel({ agentStates, toolCalls }) {
  if (!agentStates) return null;

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <div style={{
        fontSize: '0.72rem', fontWeight: 600, color: '#555565',
        textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '0.75rem',
      }}>
        Agent Pipeline Activity
      </div>
      <div className="agent-grid">
        {AGENTS.map(agent => (
          <AgentCard
            key={agent.id}
            agent={agent}
            agentState={agentStates[agent.id]}
            toolCalls={agent.id === 'planner' ? toolCalls : null}
          />
        ))}
      </div>
    </div>
  );
}
