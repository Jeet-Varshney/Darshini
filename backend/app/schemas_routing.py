"""
Darshini - Emergency Routing Schemas
Pydantic data models for route calculation, graph nodes, edge blocking, and pathfinding results.
"""

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class NodeInfo(BaseModel):
    id: str
    name: str
    type: str
    coordinates: List[float]
    svg_pos: List[int]
    capacity_pax: Optional[int] = None


class EdgeInfo(BaseModel):
    id: str
    name: str
    source: str
    target: str
    type: str
    length_meters: float
    capacity_limit_pph: int
    is_blocked: bool = False
    block_reason: Optional[str] = None
    blocked_by_name: Optional[str] = None
    blocked_at: Optional[str] = None
    source_name: Optional[str] = None
    target_name: Optional[str] = None
    coordinates: Optional[List[List[float]]] = None


class BlockEdgeRequest(BaseModel):
    reason: str = Field(..., min_length=3, max_length=500, description="Operational justification for blocking corridor/road")
    source: str = Field(default="OPERATOR", description="Source of edge block: OPERATOR or SIMULATION")


class ReopenEdgeRequest(BaseModel):
    reason: Optional[str] = Field(default="Cleared for traffic", max_length=500)


class RouteCalculationRequest(BaseModel):
    origin: str = Field(..., description="Origin node identifier (e.g. node_gate_a)")
    destination: str = Field(..., description="Destination node identifier (e.g. node_pavilion_east)")
    max_alternatives: int = Field(default=2, ge=0, le=5, description="Number of alternative bypass routes to compute")
    simulated_blocked_edges: Optional[List[str]] = Field(default=None, description="Optional ephemeral simulated blocked edges from Scenario Lab")


class RouteSegment(BaseModel):
    edge_id: str
    edge_name: str
    source_id: str
    source_name: str
    target_id: str
    target_name: str
    length_meters: float
    coordinates: List[List[float]]


class CalculatedRoute(BaseModel):
    route_index: int
    route_name: str
    total_distance_meters: float
    estimated_travel_time_sec: float
    estimated_travel_time_minutes: float
    walking_speed_mps: float = 1.2
    node_path: List[str]
    edge_path: List[str]
    segments: List[RouteSegment]
    status: str = "OPTIMAL"  # OPTIMAL | ALTERNATIVE


class RouteCalculationResponse(BaseModel):
    origin_id: str
    origin_name: str
    destination_id: str
    destination_name: str
    status: str  # FOUND | NO_PATH_AVAILABLE
    primary_route: Optional[CalculatedRoute] = None
    alternative_routes: List[CalculatedRoute] = []
    blocked_edges_encountered: List[str] = []
    disclaimer: str = "SIMULATED VENUE TOPOLOGY • Walk speed estimated at 1.2 m/s."


class BlockedEdgeAuditRecord(BaseModel):
    id: str
    edge_id: str
    action: str  # BLOCK | REOPEN
    reason: str
    operator_username: Optional[str] = None
    source: str = "OPERATOR"
    timestamp: str
