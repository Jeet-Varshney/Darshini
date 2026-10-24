/**
 * Darshini - Scenario Lab & Digital Twin Types
 * Types for NetworkX simulation requests, edge loads, bottlenecks, and comparison metrics.
 */

export interface ProjectedEdgeLoad {
  edge_id: string;
  name: string;
  source_node: string;
  target_node: string;
  corridor_type: string;
  length_meters: number;
  capacity_limit_pph: number;
  base_flow_pph: number;
  simulated_flow_pph: number;
  utilization_pct: number;
  saturation_status: 'NORMAL' | 'WARNING' | 'CRITICAL';
  breach_predicted: boolean;
  delay_factor: number;
  is_blocked: boolean;
  svg_coords: [number, number, number, number];
}

export interface NetworkNodeStatus {
  node_id: string;
  name: string;
  node_type: string;
  coordinates: [number, number];
  svg_pos: [number, number];
  inflow_pph: number;
  outflow_pph: number;
  capacity_pax: number;
  accumulation_risk: 'LOW' | 'MODERATE' | 'HIGH';
}

export interface BaselineComparison {
  network_flow_status: 'OPTIMAL' | 'ELEVATED' | 'CRITICAL_SATURATION' | 'IMPROVED' | string;
  summary: string;
  baseline_inflow_rate_pph: number;
  projected_inflow_rate_pph: number;
  baseline_avg_utilization_pct: number;
  projected_avg_utilization_pct: number;
  utilization_delta_pct: number;
  baseline_critical_bottlenecks: number;
  projected_critical_bottlenecks: number;
  bottlenecks_delta: number;
  estimated_clearance_minutes_baseline: number;
  estimated_clearance_minutes_projected: number;
  clearance_time_delta_mins: number;
  peak_density_p_sqm_baseline: number;
  peak_density_p_sqm_projected: number;
  peak_density_delta_p_sqm: number;
}

export interface SimulationRunResponse {
  scenario_id: string;
  scenario_name: string;
  generated_at: string;
  execution_time_ms: number;
  status: string;
  inflow_multiplier: number;
  duration_minutes: number;
  baseline_comparison: BaselineComparison;
  projected_edge_loads: ProjectedEdgeLoad[];
  network_nodes: NetworkNodeStatus[];
  warnings: string[];
  data_provenance: {
    model: string;
    disclaimer: string;
    human_in_the_loop_notice: string;
    badge_category: string;
  };
}

export interface SimulationRunRequest {
  scenario_name?: string;
  duration_minutes?: number;
  inflow_multiplier?: number;
  crowd_multiplier?: number;
  gate_overrides?: Record<string, string>;
  gate_b_override?: string;
  road_closures?: string[];
  closed_road_ids?: string[];
  traffic_diversion_pct?: number;
  shuttle_dispatch_multiplier?: number;
}

export interface NetworkTopologyResponse {
  venue_id: string;
  venue_name: string;
  disclaimer: string;
  nodes: Array<{
    id: string;
    name: string;
    type: string;
    coordinates: [number, number];
    svg_pos: [number, number];
    base_inflow_pph: number;
    capacity_pax: number;
  }>;
  edges: Array<{
    source: string;
    target: string;
    id: string;
    name: string;
    type: string;
    length_meters: number;
    capacity_limit_pph: number;
    base_flow_pph: number;
    svg_coords: [number, number, number, number];
    is_blocked: boolean;
  }>;
}
