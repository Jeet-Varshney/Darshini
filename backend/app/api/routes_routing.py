"""
Darshini - Emergency Routing & Blocked Edge API Routes
Endpoints for node/edge topology, shortest path route solving, and operator corridor blocking.
"""

from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.auth import (
    ROLE_ADMIN,
    ROLE_CHECKIN_OPERATOR,
    ROLE_EVENT_MANAGER,
    get_current_user,
    require_role,
)
from app.schemas_routing import (
    BlockEdgeRequest,
    BlockedEdgeAuditRecord,
    EdgeInfo,
    NodeInfo,
    ReopenEdgeRequest,
    RouteCalculationRequest,
    RouteCalculationResponse,
)
from app.services.routing_service import RoutingService

router = APIRouter(prefix="/api/v1/routing", tags=["Emergency Routing & Pathfinding"])


@router.get(
    "/nodes",
    response_model=List[NodeInfo],
    summary="List Routing Nodes",
    description="Returns all gates, junctions, plazas, and assembly points available for pathfinding.",
)
async def list_nodes():
    return RoutingService.get_all_nodes()


@router.get(
    "/edges",
    response_model=List[EdgeInfo],
    summary="List Road & Corridor Edges",
    description="Returns all venue edges with their current blocked status and coordinates.",
)
async def list_edges():
    return RoutingService.get_edges_with_status()


@router.post(
    "/calculate",
    response_model=RouteCalculationResponse,
    summary="Calculate Emergency Route",
    description="Calculates shortest cleared corridor and alternatives using NetworkX Dijkstra, excluding blocked edges.",
)
async def calculate_route(req: RouteCalculationRequest):
    try:
        return RoutingService.calculate_route(
            origin_id=req.origin,
            destination_id=req.destination,
            max_alternatives=req.max_alternatives,
            simulated_blocked_edges=req.simulated_blocked_edges,
        )
    except KeyError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post(
    "/edges/{edge_id}/block",
    summary="Block Road or Corridor",
    description="Blocks a graph edge due to crowd surge, debris, or hazard, excluding it from routing.",
)
async def block_edge(
    edge_id: str,
    req: BlockEdgeRequest,
    user: Dict[str, Any] = Depends(require_role(ROLE_CHECKIN_OPERATOR, ROLE_EVENT_MANAGER, ROLE_ADMIN)),
):
    try:
        return RoutingService.block_edge(
            edge_id=edge_id,
            reason=req.reason,
            operator_id=user["id"],
            operator_name=user["username"],
            source=req.source or "OPERATOR",
        )
    except KeyError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.post(
    "/edges/{edge_id}/reopen",
    summary="Reopen Blocked Edge",
    description="Restores a blocked road or corridor to emergency routing eligibility.",
)
async def reopen_edge(
    edge_id: str,
    req: ReopenEdgeRequest,
    user: Dict[str, Any] = Depends(require_role(ROLE_CHECKIN_OPERATOR, ROLE_EVENT_MANAGER, ROLE_ADMIN)),
):
    try:
        return RoutingService.reopen_edge(
            edge_id=edge_id,
            reason=req.reason or "Cleared for traffic",
            operator_id=user["id"],
            operator_name=user["username"],
        )
    except KeyError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.get(
    "/edges/{edge_id}/history",
    response_model=List[BlockedEdgeAuditRecord],
    summary="Get Edge Block/Reopen History",
)
async def get_edge_history(edge_id: str):
    return RoutingService.get_edge_history(edge_id)
