import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type {
  SimulationRunRequest,
  SimulationRunResponse,
  NetworkTopologyResponse,
  ProjectedEdgeLoad,
  NetworkNodeStatus,
} from '../types/simulation';
import { runSimulation, fetchNetworkTopology } from '../services/simulationApi';

interface ScenarioPreset {
  id: string;
  label: string;
  params: SimulationRunRequest;
}

const PRESETS: ScenarioPreset[] = [
  {
    id: 'baseline',
    label: 'Baseline (1.0x)',
    params: {
      inflow_multiplier: 1.0,
      gate_b_override: 'OPEN',
      traffic_diversion_pct: 0,
      closed_road_ids: [],
    },
  },
  {
    id: 'surge_15',
    label: 'Heavy Surge (1.5x)',
    params: {
      inflow_multiplier: 1.5,
      gate_b_override: 'OPEN',
      traffic_diversion_pct: 0,
      closed_road_ids: [],
    },
  },
  {
    id: 'surge_20',
    label: 'Peak Saturation (2.0x)',
    params: {
      inflow_multiplier: 2.0,
      gate_b_override: 'OPEN',
      traffic_diversion_pct: 0,
      closed_road_ids: [],
    },
  },
  {
    id: 'gate_b_restricted',
    label: 'Gate B Restricted (50%)',
    params: {
      inflow_multiplier: 1.5,
      gate_b_override: 'RESTRICTED',
      traffic_diversion_pct: 0,
      closed_road_ids: [],
    },
  },
  {
    id: 'perimeter_diversion',
    label: 'Perimeter Diversion (40%)',
    params: {
      inflow_multiplier: 1.8,
      gate_b_override: 'OPEN',
      traffic_diversion_pct: 40,
      closed_road_ids: [],
    },
  },
];

export const ScenarioLab: React.FC = () => {
  // Scenario parameter state
  const [inflowMultiplier, setInflowMultiplier] = useState<number>(1.0);
  const [gateBOverride, setGateBOverride] = useState<'OPEN' | 'RESTRICTED' | 'CLOSED'>('OPEN');
  const [trafficDiversionPct, setTrafficDiversionPct] = useState<number>(0);
  const [closedRoadIds, setClosedRoadIds] = useState<string[]>([]);
  const [activePresetId, setActivePresetId] = useState<string>('baseline');

  // Simulation execution state
  const [, setTopology] = useState<NetworkTopologyResponse | null>(null);
  const [simulationResult, setSimulationResult] = useState<SimulationRunResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Inspector selection
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>('edge_north_spine');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Track if current controls differ from the executed simulation
  const [lastExecutedParams, setLastExecutedParams] = useState<SimulationRunRequest>({
    inflow_multiplier: 1.0,
    gate_b_override: 'OPEN',
    traffic_diversion_pct: 0,
    closed_road_ids: [],
  });

  const isDirty = useMemo(() => {
    if (!simulationResult) return false;
    if (Math.abs((lastExecutedParams.inflow_multiplier ?? 1.0) - inflowMultiplier) > 0.01) return true;
    if (lastExecutedParams.gate_b_override !== gateBOverride) return true;
    if (Math.abs((lastExecutedParams.traffic_diversion_pct ?? 0) - trafficDiversionPct) > 0.1) return true;
    const reqSet = new Set(lastExecutedParams.closed_road_ids || []);
    const currSet = new Set(closedRoadIds);
    if (reqSet.size !== currSet.size) return true;
    for (const id of reqSet) {
      if (!currSet.has(id)) return true;
    }
    return false;
  }, [simulationResult, lastExecutedParams, inflowMultiplier, gateBOverride, trafficDiversionPct, closedRoadIds]);

  // Execute simulation against backend
  const executeSimulation = useCallback(
    async (params: SimulationRunRequest) => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await runSimulation(params);
        setSimulationResult(result);
        setLastExecutedParams(params);
      } catch (err: any) {
        setError(err.message || 'Simulation execution failed');
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  // Initial load: Fetch network topology and execute baseline simulation
  useEffect(() => {
    let isMounted = true;
    const init = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const initialParams: SimulationRunRequest = {
          inflow_multiplier: 1.0,
          gate_b_override: 'OPEN',
          traffic_diversion_pct: 0,
          closed_road_ids: [],
        };
        const [topo, sim] = await Promise.all([
          fetchNetworkTopology(),
          runSimulation(initialParams),
        ]);
        if (isMounted) {
          setTopology(topo);
          setSimulationResult(sim);
          setLastExecutedParams(initialParams);
        }
      } catch (err: any) {
        if (isMounted) {
          setError(
            err.message ||
              'Failed to connect to Darshini simulation service. Ensure backend is running.'
          );
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };
    init();
    return () => {
      isMounted = false;
    };
  }, []);

  // Handle Preset Selection
  const handleSelectPreset = (preset: ScenarioPreset) => {
    setActivePresetId(preset.id);
    setInflowMultiplier(preset.params.inflow_multiplier ?? 1.0);
    setGateBOverride((preset.params.gate_b_override as any) ?? 'OPEN');
    setTrafficDiversionPct(preset.params.traffic_diversion_pct ?? 0);
    setClosedRoadIds(preset.params.closed_road_ids ?? []);
    executeSimulation(preset.params);
  };

  // Handle Manual Run
  const handleRunSimulation = () => {
    setActivePresetId('');
    executeSimulation({
      inflow_multiplier: inflowMultiplier,
      gate_b_override: gateBOverride,
      traffic_diversion_pct: trafficDiversionPct,
      closed_road_ids: closedRoadIds,
    });
  };

  // Handle Reset to Baseline
  const handleReset = () => {
    const baseline = PRESETS[0];
    handleSelectPreset(baseline);
  };

  // Toggle Road Closure
  const handleToggleRoadClosure = (roadId: string) => {
    setActivePresetId('');
    setClosedRoadIds((prev) =>
      prev.includes(roadId) ? prev.filter((id) => id !== roadId) : [...prev, roadId]
    );
  };

  // Selected edge object from current simulation
  const selectedEdge: ProjectedEdgeLoad | undefined = useMemo(() => {
    if (!simulationResult || !selectedEdgeId) return undefined;
    return simulationResult.projected_edge_loads.find((e) => e.edge_id === selectedEdgeId);
  }, [simulationResult, selectedEdgeId]);

  // Selected node object from current simulation
  const selectedNode: NetworkNodeStatus | undefined = useMemo(() => {
    if (!simulationResult || !selectedNodeId) return undefined;
    return simulationResult.network_nodes.find((n) => n.node_id === selectedNodeId);
  }, [simulationResult, selectedNodeId]);

  // Bottleneck corridors from projected loads
  const bottleneckCorridors = useMemo(() => {
    if (!simulationResult) return [];
    return simulationResult.projected_edge_loads.filter(
      (e) => e.breach_predicted || e.saturation_status === 'CRITICAL' || e.saturation_status === 'WARNING'
    );
  }, [simulationResult]);

  return (
    <div
      className="scenario-lab-container"
      role="tabpanel"
      id="panel-scenario-lab"
      aria-labelledby="tab-scenario-lab"
    >
      {/* Top Parameter Formulation & Preset Toolbar */}
      <header className="scenario-toolbar">
        <div className="toolbar-left">
          <div className="toolbar-title-group">
            <h2 className="toolbar-title">Scenario Lab // Digital Twin</h2>
            <span className="provenance-badge">
              SIMULATED PROJECTION • NETWORKX
            </span>
          </div>

          {/* Quick Presets */}
          <div className="scenario-presets-group" aria-label="Scenario Presets">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`preset-btn ${activePresetId === p.id ? 'active' : ''}`}
                onClick={() => handleSelectPreset(p)}
                disabled={isLoading}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="toolbar-actions">
          {simulationResult && (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                color: 'var(--text-muted)',
                marginRight: '8px',
              }}
            >
              Engine Latency: {simulationResult.execution_time_ms.toFixed(1)} ms
            </span>
          )}

          <button
            type="button"
            className="btn-secondary"
            onClick={handleReset}
            disabled={isLoading}
          >
            Reset
          </button>

          <button
            type="button"
            className={`btn-primary ${isDirty ? 'dirty' : ''}`}
            onClick={handleRunSimulation}
            disabled={isLoading}
          >
            {isLoading ? (
              <>Simulating...</>
            ) : isDirty ? (
              <>Update Simulation *</>
            ) : (
              <>Run Simulation</>
            )}
          </button>
        </div>
      </header>

      {/* Stale / Changed notice */}
      {isDirty && !isLoading && (
        <aside className="stale-notice" role="alert">
          <span>
            ⚠️ <strong>Parameters modified:</strong> Corridor loads and saturation below reflect previous run. Click <strong>[Update Simulation]</strong> to recompute.
          </span>
          <button
            type="button"
            className="btn-secondary"
            style={{ padding: '2px 8px', fontSize: '11px' }}
            onClick={handleRunSimulation}
          >
            Update Now
          </button>
        </aside>
      )}

      {/* Backend Error Banner */}
      {error && (
        <div className="simulation-error-banner" role="alert">
          <div>
            <strong>Simulation Service Error:</strong> {error}
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleRunSimulation}
          >
            Retry
          </button>
        </div>
      )}

      {/* Main Split Workspace */}
      <div className="scenario-workspace">
        {/* Left: Topological Network Twin (46% width) */}
        <section className="topology-card" aria-label="Topological Venue Network Twin">
          <div className="topology-header">
            <span className="card-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="6" cy="6" r="3" />
                <circle cx="18" cy="18" r="3" />
                <line x1="8.5" y1="8.5" x2="15.5" y2="15.5" />
                <circle cx="18" cy="6" r="3" />
                <line x1="8.5" y1="6" x2="15.5" y2="6" />
              </svg>
              Topological Network Twin
            </span>

            <div className="topology-legend" aria-label="Saturation Legend">
              <span className="legend-item">
                <span className="legend-swatch normal" /> &lt;60% Normal
              </span>
              <span className="legend-item">
                <span className="legend-swatch warning" /> 60-85% Warning
              </span>
              <span className="legend-item">
                <span className="legend-swatch critical" /> &gt;85% Saturated
              </span>
              <span className="legend-item">
                <span className="legend-swatch closed" /> Closed
              </span>
            </div>
          </div>

          {/* SVG Canvas */}
          <div className="topology-canvas-container">
            <svg
              className="topology-svg"
              viewBox="0 0 900 510"
              preserveAspectRatio="xMidYMid meet"
              role="img"
              aria-label="Venue road and concourse network graph"
            >
              <defs>
                <marker
                  id="arrow-normal"
                  markerWidth="8"
                  markerHeight="8"
                  refX="6"
                  refY="4"
                  orient="auto"
                >
                  <polygon points="0 0, 8 4, 0 8" fill="#237A57" />
                </marker>
                <marker
                  id="arrow-warning"
                  markerWidth="8"
                  markerHeight="8"
                  refX="6"
                  refY="4"
                  orient="auto"
                >
                  <polygon points="0 0, 8 4, 0 8" fill="#A15C00" />
                </marker>
                <marker
                  id="arrow-critical"
                  markerWidth="8"
                  markerHeight="8"
                  refX="6"
                  refY="4"
                  orient="auto"
                >
                  <polygon points="0 0, 8 4, 0 8" fill="#B42318" />
                </marker>
              </defs>

              {/* Background venue outline boundary */}
              <rect
                x="20"
                y="10"
                width="860"
                height="480"
                rx="12"
                fill="none"
                stroke="#E2E8F0"
                strokeWidth="2"
                strokeDasharray="6 4"
              />
              <text x="35" y="475" fill="#94A3B8" fontSize="11" fontFamily="var(--font-mono)">
                FICTIONAL PRECINCT BOUNDARY • 13 TOPOLOGY NODES • 12 MONITORED CORRIDORS
              </text>

              {/* Edges */}
              {simulationResult?.projected_edge_loads.map((edge) => {
                const [x1, y1, x2, y2] = edge.svg_coords;
                const isSelected = selectedEdgeId === edge.edge_id;
                const isBottleneck = edge.breach_predicted || edge.saturation_status === 'CRITICAL';
                const isClosed = edge.is_blocked;

                // Color mapping
                let strokeColor = '#237A57'; // Normal Green
                let markerId = 'url(#arrow-normal)';
                if (isClosed) {
                  strokeColor = '#94A3B8';
                  markerId = '';
                } else if (edge.utilization_pct >= 85) {
                  strokeColor = '#B42318'; // Critical Red
                  markerId = 'url(#arrow-critical)';
                } else if (edge.utilization_pct >= 60) {
                  strokeColor = '#A15C00'; // Warning Amber
                  markerId = 'url(#arrow-warning)';
                }

                // Width proportional to capacity (range 3px to 8px)
                const strokeWidth = isClosed
                  ? 2
                  : Math.max(3, Math.min(8, Math.round((edge.capacity_limit_pph / 1000) * 1.5)));

                const midX = (x1 + x2) / 2;
                const midY = (y1 + y2) / 2;

                return (
                  <g
                    key={edge.edge_id}
                    onClick={() => {
                      setSelectedEdgeId(edge.edge_id);
                      setSelectedNodeId(null);
                    }}
                  >
                    {/* Transparent hit target */}
                    <line
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke="transparent"
                      strokeWidth={16}
                      style={{ cursor: 'pointer' }}
                    />
                    {/* Visual Corridor Line */}
                    <line
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke={strokeColor}
                      strokeWidth={strokeWidth}
                      strokeDasharray={isClosed ? '6 4' : undefined}
                      markerEnd={markerId}
                      className={`svg-edge ${isSelected ? 'selected' : ''} ${
                        isBottleneck ? 'bottleneck-pulse' : ''
                      }`}
                    />
                    {/* Saturation badge label at edge midpoint */}
                    <g transform={`translate(${midX}, ${midY})`}>
                      <rect
                        x="-26"
                        y="-10"
                        width="52"
                        height="18"
                        rx="4"
                        fill={isClosed ? '#475569' : strokeColor}
                        opacity="0.9"
                      />
                      <text
                        x="0"
                        y="3"
                        fill="#FFFFFF"
                        fontSize="10"
                        fontFamily="var(--font-mono)"
                        fontWeight="700"
                        textAnchor="middle"
                      >
                        {isClosed ? 'CLOSED' : `${edge.utilization_pct.toFixed(0)}%`}
                      </text>
                    </g>
                  </g>
                );
              })}

              {/* Nodes */}
              {simulationResult?.network_nodes.map((node) => {
                const [cx, cy] = node.svg_pos;
                const isSelected = selectedNodeId === node.node_id;
                const isGate = node.node_type === 'GATE';
                const isTerminal = node.node_type === 'TRANSIT_HUB';
                const isJunction = node.node_type === 'JUNCTION';

                let nodeFill = '#FFFFFF';
                let nodeStroke = '#365F8D';
                let radius = 10;

                if (isGate) {
                  nodeFill = '#EBF1F7';
                  nodeStroke = '#365F8D';
                  radius = 12;
                } else if (isTerminal) {
                  nodeFill = '#FEF0C7';
                  nodeStroke = '#A15C00';
                  radius = 12;
                } else if (isJunction) {
                  nodeFill = '#F1F5F9';
                  nodeStroke = '#64748B';
                  radius = 8;
                }

                return (
                  <g
                    key={node.node_id}
                    className={`svg-node ${isSelected ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedNodeId(node.node_id);
                      setSelectedEdgeId(null);
                    }}
                  >
                    <circle
                      cx={cx}
                      cy={cy}
                      r={radius}
                      fill={nodeFill}
                      stroke={nodeStroke}
                      strokeWidth={isSelected ? 3.5 : 2}
                    />
                    {/* Node Text Label */}
                    <text
                      x={cx}
                      y={cy + (cy < 100 ? -16 : 22)}
                      fill="#1E293B"
                      fontSize="10.5"
                      fontFamily="var(--font-sans)"
                      fontWeight="600"
                      textAnchor="middle"
                    >
                      {node.name.replace(' Arrival Plaza', ' Plaza').replace(' Concourse', '')}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Inspector Panel */}
          <div className="topology-inspector">
            {selectedEdge ? (
              <>
                <div className="inspector-header">
                  <span>CORRIDOR: {selectedEdge.name}</span>
                  <span
                    className="provenance-badge"
                    style={{
                      backgroundColor: selectedEdge.breach_predicted
                        ? 'var(--status-critical-bg)'
                        : 'var(--surface-secondary)',
                      color: selectedEdge.breach_predicted
                        ? 'var(--status-critical)'
                        : 'var(--text-secondary)',
                      borderColor: selectedEdge.breach_predicted
                        ? 'var(--status-critical-border)'
                        : 'var(--border-default)',
                    }}
                  >
                    {selectedEdge.is_blocked
                      ? 'ROAD CLOSED'
                      : selectedEdge.breach_predicted
                      ? 'CAPACITY BREACH'
                      : `${selectedEdge.saturation_status} SATURATION`}
                  </span>
                </div>

                <div className="inspector-grid">
                  <div className="inspector-stat">
                    <span className="inspector-stat-label">Projected Flow</span>
                    <span className="inspector-stat-value">
                      {selectedEdge.simulated_flow_pph.toLocaleString()} pph
                    </span>
                  </div>
                  <div className="inspector-stat">
                    <span className="inspector-stat-label">Physical Capacity</span>
                    <span className="inspector-stat-value">
                      {selectedEdge.capacity_limit_pph.toLocaleString()} pph
                    </span>
                  </div>
                  <div className="inspector-stat">
                    <span className="inspector-stat-label">Saturation Ratio</span>
                    <span
                      className="inspector-stat-value"
                      style={{
                        color:
                          selectedEdge.utilization_pct >= 85
                            ? 'var(--status-critical)'
                            : selectedEdge.utilization_pct >= 60
                            ? 'var(--status-warning)'
                            : 'var(--status-positive)',
                      }}
                    >
                      {selectedEdge.utilization_pct.toFixed(1)}%
                    </span>
                  </div>
                  <div className="inspector-stat">
                    <span className="inspector-stat-label">Intervention</span>
                    <button
                      type="button"
                      style={{
                        border: 'none',
                        background: selectedEdge.is_blocked ? '#FEE4E2' : '#EEF2F6',
                        color: selectedEdge.is_blocked ? '#B42318' : '#365F8D',
                        fontSize: '11px',
                        fontWeight: 700,
                        padding: '2px 6px',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                      onClick={() => handleToggleRoadClosure(selectedEdge.edge_id)}
                    >
                      {selectedEdge.is_blocked ? 'Reopen Road' : 'Simulate Closure'}
                    </button>
                  </div>
                </div>

                {selectedEdge.breach_predicted && (
                  <p style={{ margin: 0, fontSize: '11px', color: 'var(--status-critical)' }}>
                    ⚠️ Capacity exceeded by +{(selectedEdge.simulated_flow_pph - selectedEdge.capacity_limit_pph).toLocaleString()} pax/hr. Diversion recommended.
                  </p>
                )}
              </>
            ) : selectedNode ? (
              <>
                <div className="inspector-header">
                  <span>NODE: {selectedNode.name}</span>
                  <span className="provenance-badge">{selectedNode.node_type}</span>
                </div>
                <div className="inspector-grid">
                  <div className="inspector-stat">
                    <span className="inspector-stat-label">Inflow Demand</span>
                    <span className="inspector-stat-value">
                      {selectedNode.inflow_pph.toLocaleString()} pph
                    </span>
                  </div>
                  <div className="inspector-stat">
                    <span className="inspector-stat-label">Outflow Throughput</span>
                    <span className="inspector-stat-value">
                      {selectedNode.outflow_pph.toLocaleString()} pph
                    </span>
                  </div>
                  <div className="inspector-stat">
                    <span className="inspector-stat-label">Holding Capacity</span>
                    <span className="inspector-stat-value">
                      {selectedNode.capacity_pax.toLocaleString()} pax
                    </span>
                  </div>
                  <div className="inspector-stat">
                    <span className="inspector-stat-label">Accumulation Risk</span>
                    <span
                      className="inspector-stat-value"
                      style={{
                        color:
                          selectedNode.accumulation_risk === 'HIGH'
                            ? 'var(--status-critical)'
                            : selectedNode.accumulation_risk === 'MODERATE'
                            ? 'var(--status-warning)'
                            : 'var(--status-positive)',
                      }}
                    >
                      {selectedNode.accumulation_risk}
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <div style={{ color: 'var(--text-muted)' }}>
                Click any corridor or node in the topological canvas to inspect flow dynamics.
              </div>
            )}
          </div>
        </section>

        {/* Right Stack: Controls & Metrics Stack (54% width) */}
        <div className="scenario-right-stack">
          {/* Panel 1: Intervention Controls */}
          <section className="scenario-card" aria-label="Intervention Parameters">
            <div className="card-title-bar">
              <span className="card-title">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="4" y1="21" x2="4" y2="14" />
                  <line x1="4" y1="10" x2="4" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12" y2="3" />
                  <line x1="20" y1="21" x2="20" y2="16" />
                  <line x1="20" y1="12" x2="20" y2="3" />
                  <line x1="1" y1="14" x2="7" y2="14" />
                  <line x1="9" y1="8" x2="15" y2="8" />
                  <line x1="17" y1="16" x2="23" y2="16" />
                </svg>
                Intervention Parameters Workbench
              </span>
              <span className="provenance-badge">WHAT-IF INPUTS</span>
            </div>

            <div className="card-body">
              <div className="controls-grid">
                {/* Crowd Inflow Multiplier */}
                <div className="control-item">
                  <div className="control-label-row">
                    <label htmlFor="multiplier-slider" className="control-label">
                      Crowd Multiplier
                    </label>
                    <span className="control-value-badge">
                      {inflowMultiplier.toFixed(2)}x
                    </span>
                  </div>
                  <div className="slider-container">
                    <input
                      id="multiplier-slider"
                      type="range"
                      min="1.0"
                      max="2.0"
                      step="0.05"
                      value={inflowMultiplier}
                      onChange={(e) => {
                        setInflowMultiplier(parseFloat(e.target.value));
                        setActivePresetId('');
                      }}
                      className="slider-input"
                    />
                    <div className="slider-scale">
                      <span>1.0x (Baseline)</span>
                      <span>1.5x (Surge)</span>
                      <span>2.0x (Peak Saturation)</span>
                    </div>
                  </div>
                  <div className="btn-pill-group">
                    {[1.0, 1.25, 1.5, 1.75, 2.0].map((val) => (
                      <button
                        key={val}
                        type="button"
                        className={`btn-pill ${
                          Math.abs(inflowMultiplier - val) < 0.01 ? 'active' : ''
                        }`}
                        onClick={() => {
                          setInflowMultiplier(val);
                          setActivePresetId('');
                        }}
                      >
                        {val.toFixed(2)}x
                      </button>
                    ))}
                  </div>
                </div>

                {/* Gate B Inflow Override */}
                <div className="control-item">
                  <div className="control-label-row">
                    <label className="control-label">Gate B Access State</label>
                    <span className="control-value-badge">{gateBOverride}</span>
                  </div>
                  <div className="btn-pill-group" style={{ marginTop: '8px' }}>
                    {(['OPEN', 'RESTRICTED', 'CLOSED'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        className={`btn-pill ${gateBOverride === mode ? 'active' : ''}`}
                        onClick={() => {
                          setGateBOverride(mode);
                          setActivePresetId('');
                        }}
                      >
                        {mode === 'OPEN'
                          ? 'Open (100%)'
                          : mode === 'RESTRICTED'
                          ? 'Restricted (50%)'
                          : 'Closed (0%)'}
                      </button>
                    ))}
                  </div>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Controls East Pavilion turnstile intake rate.
                  </span>
                </div>

                {/* Perimeter Road Traffic Diversion */}
                <div className="control-item">
                  <div className="control-label-row">
                    <label htmlFor="diversion-slider" className="control-label">
                      Perimeter Road Traffic Diversion
                    </label>
                    <span className="control-value-badge">
                      {trafficDiversionPct.toFixed(0)}%
                    </span>
                  </div>
                  <div className="slider-container">
                    <input
                      id="diversion-slider"
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={trafficDiversionPct}
                      onChange={(e) => {
                        setTrafficDiversionPct(parseFloat(e.target.value));
                        setActivePresetId('');
                      }}
                      className="slider-input"
                    />
                    <div className="slider-scale">
                      <span>0% (Direct)</span>
                      <span>50% (Balanced)</span>
                      <span>100% (Full Outer Bypass)</span>
                    </div>
                  </div>
                </div>

                {/* Active Road Closures */}
                <div className="control-item">
                  <div className="control-label-row">
                    <label className="control-label">Road & Corridor Closures</label>
                    <span className="control-value-badge">
                      {closedRoadIds.length} Blocked
                    </span>
                  </div>
                  <div className="closures-list">
                    {[
                      { id: 'edge_north_spine', label: 'North Spine' },
                      { id: 'edge_south_spine', label: 'South Spine' },
                      { id: 'edge_north_ring', label: 'North Ring Road' },
                      { id: 'edge_concourse_east', label: 'East Concourse' },
                    ].map((item) => {
                      const isClosed = closedRoadIds.includes(item.id);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={`closure-chip ${isClosed ? 'closed' : ''}`}
                          onClick={() => handleToggleRoadClosure(item.id)}
                        >
                          {isClosed ? '⛔' : '✓'} {item.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Panel 2: Scenario Comparison Matrix */}
          <section className="scenario-card" aria-label="Baseline versus Proposed Comparison Matrix">
            <div className="card-title-bar">
              <span className="card-title">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <line x1="3" y1="9" x2="21" y2="9" />
                  <line x1="9" y1="21" x2="9" y2="9" />
                </svg>
                Baseline vs. Proposed Outcome Matrix
              </span>
              <span className="provenance-badge">
                EVALUATION AT {inflowMultiplier.toFixed(2)}x
              </span>
            </div>

            <div className="card-body">
              {simulationResult ? (
                <div className="comparison-table-wrapper">
                  <table className="comparison-table">
                    <thead>
                      <tr>
                        <th>Metric</th>
                        <th>Baseline (1.0x)</th>
                        <th>Proposed Scenario</th>
                        <th>Delta / Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Metric 1: Total Inflow */}
                      <tr>
                        <td className="metric-name">Total Network Inflow</td>
                        <td className="metric-baseline">
                          {simulationResult.baseline_comparison.baseline_inflow_rate_pph.toLocaleString()} pph
                        </td>
                        <td className="metric-projected">
                          {simulationResult.baseline_comparison.projected_inflow_rate_pph.toLocaleString()} pph
                        </td>
                        <td>
                          {(() => {
                            const b = simulationResult.baseline_comparison.baseline_inflow_rate_pph;
                            const p = simulationResult.baseline_comparison.projected_inflow_rate_pph;
                            const deltaPct = b > 0 ? ((p - b) / b) * 100 : 0;
                            return (
                              <span
                                className={`delta-badge ${
                                  deltaPct > 0 ? 'neutral' : 'positive'
                                }`}
                              >
                                {deltaPct > 0 ? '+' : ''}
                                {deltaPct.toFixed(1)}%
                              </span>
                            );
                          })()}
                        </td>
                      </tr>

                      {/* Metric 2: Average Utilization */}
                      <tr>
                        <td className="metric-name">Average Network Utilization</td>
                        <td className="metric-baseline">
                          {simulationResult.baseline_comparison.baseline_avg_utilization_pct.toFixed(1)}%
                        </td>
                        <td className="metric-projected">
                          {simulationResult.baseline_comparison.projected_avg_utilization_pct.toFixed(1)}%
                        </td>
                        <td>
                          <span
                            className={`delta-badge ${
                              simulationResult.baseline_comparison.utilization_delta_pct > 20
                                ? 'negative'
                                : simulationResult.baseline_comparison.utilization_delta_pct > 0
                                ? 'warning'
                                : 'positive'
                            }`}
                          >
                            {simulationResult.baseline_comparison.utilization_delta_pct > 0 ? '+' : ''}
                            {simulationResult.baseline_comparison.utilization_delta_pct.toFixed(1)}%
                          </span>
                        </td>
                      </tr>

                      {/* Metric 3: Critical Bottlenecks */}
                      <tr>
                        <td className="metric-name">Critical Bottlenecks (&gt;85%)</td>
                        <td className="metric-baseline">
                          {simulationResult.baseline_comparison.baseline_critical_bottlenecks} corridors
                        </td>
                        <td className="metric-projected">
                          {simulationResult.baseline_comparison.projected_critical_bottlenecks} corridors
                        </td>
                        <td>
                          <span
                            className={`delta-badge ${
                              simulationResult.baseline_comparison.bottlenecks_delta > 0
                                ? 'negative'
                                : simulationResult.baseline_comparison.bottlenecks_delta === 0
                                ? 'neutral'
                                : 'positive'
                            }`}
                          >
                            {simulationResult.baseline_comparison.bottlenecks_delta > 0 ? '+' : ''}
                            {simulationResult.baseline_comparison.bottlenecks_delta}
                          </span>
                        </td>
                      </tr>

                      {/* Metric 4: Clearance Duration */}
                      <tr>
                        <td className="metric-name">Est. Clearance Duration</td>
                        <td className="metric-baseline">
                          {simulationResult.baseline_comparison.estimated_clearance_minutes_baseline.toFixed(1)} mins
                        </td>
                        <td className="metric-projected">
                          {simulationResult.baseline_comparison.estimated_clearance_minutes_projected.toFixed(1)} mins
                        </td>
                        <td>
                          <span
                            className={`delta-badge ${
                              simulationResult.baseline_comparison.clearance_time_delta_mins > 10
                                ? 'negative'
                                : simulationResult.baseline_comparison.clearance_time_delta_mins > 0
                                ? 'warning'
                                : 'positive'
                            }`}
                          >
                            {simulationResult.baseline_comparison.clearance_time_delta_mins > 0 ? '+' : ''}
                            {simulationResult.baseline_comparison.clearance_time_delta_mins.toFixed(1)} mins
                          </span>
                        </td>
                      </tr>

                      {/* Metric 5: Peak Density */}
                      <tr>
                        <td className="metric-name">Peak Zone Density</td>
                        <td className="metric-baseline">
                          {simulationResult.baseline_comparison.peak_density_p_sqm_baseline.toFixed(2)} p/m²
                        </td>
                        <td className="metric-projected">
                          {simulationResult.baseline_comparison.peak_density_p_sqm_projected.toFixed(2)} p/m²
                        </td>
                        <td>
                          <span
                            className={`delta-badge ${
                              simulationResult.baseline_comparison.peak_density_delta_p_sqm > 1.0
                                ? 'negative'
                                : simulationResult.baseline_comparison.peak_density_delta_p_sqm > 0
                                ? 'warning'
                                : 'positive'
                            }`}
                          >
                            {simulationResult.baseline_comparison.peak_density_delta_p_sqm > 0 ? '+' : ''}
                            {simulationResult.baseline_comparison.peak_density_delta_p_sqm.toFixed(2)} p/m²
                          </span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
                  Awaiting simulation execution...
                </div>
              )}
            </div>
          </section>

          {/* Panel 3: Capacity Breach Warnings & Bottlenecks */}
          <section className="scenario-card" aria-label="Capacity Breach Alerts">
            <div className="card-title-bar">
              <span className="card-title">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                Capacity Breach & Chokepoint Alerts
              </span>
              <span className="provenance-badge">
                {bottleneckCorridors.length} Monitored
              </span>
            </div>

            <div className="card-body">
              {bottleneckCorridors.length > 0 ? (
                <div className="bottlenecks-list">
                  {bottleneckCorridors.map((b) => (
                    <div
                      key={b.edge_id}
                      className={`bottleneck-item ${
                        b.utilization_pct >= 85 ? 'critical' : 'warning'
                      }`}
                    >
                      <div className="bottleneck-head">
                        <span>{b.name}</span>
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontWeight: 700,
                          }}
                        >
                          {b.utilization_pct.toFixed(1)}% Capacity ({b.simulated_flow_pph.toLocaleString()} / {b.capacity_limit_pph.toLocaleString()} pph)
                        </span>
                      </div>
                      <div className="bottleneck-desc">
                        {b.breach_predicted
                          ? `Corridor capacity breached by ${(b.utilization_pct - 100).toFixed(1)}%. Flow rate exceeds structural threshold.`
                          : `Corridor approaches saturation limit (${b.utilization_pct.toFixed(1)}% utilization).`}
                      </div>
                      <div className="bottleneck-action">
                        {b.breach_predicted
                          ? 'Operational Recommendation: Enforce turnstile inflow metering and activate perimeter ring diversion.'
                          : 'Operational Recommendation: Prepare auxiliary concourse bypass if crowd rate increases.'}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="no-bottlenecks-card">
                  <span>✓</span>
                  <span>
                    All monitored corridors operating within safe capacity bounds (&lt;60% saturation). No active chokepoints predicted.
                  </span>
                </div>
              )}
            </div>
          </section>

          <footer className="provenance-footer">
            Darshini Digital Twin Engine • NetworkX Graph Model • Operational Prototype Decision Support Only
          </footer>
        </div>
      </div>
    </div>
  );
};
