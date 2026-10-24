/**
 * Darshini - Emergency Routing Type Definitions
 */

export interface RoutingNode {
  id: string;
  name: string;
  type: string;
  coordinates: [number, number];
  svg_pos: [number, number];
  capacity_pax?: number | null;
}
export type NodeInfo = RoutingNode;

export interface RoutingEdge {
  id: string;
  name: string;
  source: string;
  target: string;
  type: string;
  length_meters: number;
  capacity_limit_pph: number;
  is_blocked: boolean;
  block_reason?: string | null;
  blocked_by_name?: string | null;
  blocked_at?: string | null;
  source_name?: string | null;
  target_name?: string | null;
  coordinates?: [[number, number], [number, number]] | null;
}
export type EdgeInfo = RoutingEdge;

export interface RouteSegment {
  edge_id: string;
  edge_name: string;
  source_id: string;
  source_name: string;
  target_id: string;
  target_name: string;
  length_meters: number;
  coordinates: [[number, number], [number, number]];
}

export interface CalculatedRoute {
  route_index: number;
  route_name: string;
  total_distance_meters: number;
  estimated_travel_time_sec: number;
  estimated_travel_time_minutes: number;
  walking_speed_mps: number;
  node_path: string[];
  edge_path: string[];
  segments: RouteSegment[];
  status: 'OPTIMAL' | 'ALTERNATIVE';
}

export interface RouteCalculationResponse {
  origin_id: string;
  origin_name: string;
  destination_id: string;
  destination_name: string;
  status: 'FOUND' | 'NO_PATH_AVAILABLE';
  primary_route?: CalculatedRoute | null;
  alternative_routes: CalculatedRoute[];
  blocked_edges_encountered: string[];
  disclaimer: string;
}

export interface BlockedEdgeAuditRecord {
  id: string;
  edge_id: string;
  action: 'BLOCK' | 'REOPEN';
  reason: string;
  operator_username?: string | null;
  source: string;
  timestamp: string;
}
