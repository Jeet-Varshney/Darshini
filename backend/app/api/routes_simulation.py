"""
Darshini - Digital Twin Simulation API Routes
Exposes what-if crowd capacity simulation and topological network endpoints.
"""

import logging
from typing import Dict, Any
from fastapi import APIRouter, HTTPException, status

from app.schemas import (
    SimulationRunRequest,
    SimulationRunResponse,
)
from app.services.simulation_service import simulation_service
from app.services.network_service import network_service

logger = logging.getLogger("darshini.routes_simulation")

router = APIRouter(tags=["simulation"])


@router.post(
    "/api/v1/simulation/run",
    response_model=SimulationRunResponse,
    summary="Run what-if scenario simulation",
    description="Executes NetworkX flow simulation with crowd multipliers, gate overrides, and road closures. Returns within 250ms.",
)
async def run_scenario_simulation(request: SimulationRunRequest):
    """
    Executes a what-if capacity and flow simulation over the venue graph.
    Returns baseline vs projected corridor loads, bottleneck warnings, and clearance delta.
    """
    try:
        inflow_mult = (
            request.crowd_multiplier
            if request.crowd_multiplier is not None
            else request.inflow_multiplier
        )
        road_closures = (
            request.closed_road_ids
            if request.closed_road_ids
            else (request.road_closures or [])
        )
        gate_overrides = dict(request.gate_overrides or {})
        if request.gate_b_override:
            gate_overrides["node_gate_b"] = request.gate_b_override

        result = simulation_service.run_simulation(
            inflow_multiplier=inflow_mult,
            scenario_name=request.scenario_name,
            duration_minutes=request.duration_minutes,
            gate_overrides=gate_overrides,
            road_closures=road_closures,
            traffic_diversion_pct=request.traffic_diversion_pct,
            shuttle_dispatch_multiplier=request.shuttle_dispatch_multiplier,
        )
        return SimulationRunResponse(**result)
    except Exception as e:
        logger.error("Simulation run failed: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Simulation calculation failed: {str(e)}",
        )


@router.get(
    "/api/v1/simulation/network",
    summary="Get venue network topology",
    description="Returns nodes, edges, default capacities, and layout coordinates of the venue graph.",
)
async def get_network_topology():
    """Returns the static node-link graph data for topological rendering."""
    try:
        return {
            "venue_id": network_service.raw_data.get("venue_id"),
            "venue_name": network_service.raw_data.get("venue_name"),
            "disclaimer": network_service.raw_data.get("disclaimer"),
            "nodes": network_service.get_nodes(),
            "edges": network_service.get_edges(),
        }
    except Exception as e:
        logger.error("Failed to retrieve network topology: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to load network topology: {str(e)}",
        )
