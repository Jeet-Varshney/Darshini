"""
Darshini - Emergency Route Solver & Blocked Edge Service
Solves shortest emergency clearance corridors using NetworkX Dijkstra pathfinding,
incorporating operator-managed road blocks, perimeter bypasses, and audit history.
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

import networkx as nx

from app.db.database import get_db, get_db_read
from app.schemas_routing import (
    BlockedEdgeAuditRecord,
    CalculatedRoute,
    EdgeInfo,
    NodeInfo,
    RouteCalculationResponse,
    RouteSegment,
)
from app.services.network_service import network_service

logger = logging.getLogger("darshini.routing_service")

# Default walking speed: 1.2 m/s (~4.3 km/h average brisk walking/evacuation speed)
DEFAULT_WALKING_SPEED_MPS = 1.2

# Additional emergency perimeter bypass lanes linking gates to the perimeter road ring
PERIMETER_BYPASS_EDGES = [
    {
        "id": "edge_bypass_gate_a_ne",
        "name": "North Gate A to NE Perimeter Bypass",
        "source": "node_gate_a",
        "target": "node_perimeter_ne",
        "type": "ROAD",
        "length_meters": 350.0,
        "capacity_limit_pph": 2000,
        "base_flow_pph": 200,
    },
    {
        "id": "edge_bypass_gate_b_se",
        "name": "East Gate B to SE Perimeter Bypass",
        "source": "node_gate_b",
        "target": "node_perimeter_se",
        "type": "ROAD",
        "length_meters": 320.0,
        "capacity_limit_pph": 2000,
        "base_flow_pph": 200,
    },
    {
        "id": "edge_bypass_gate_c_sw",
        "name": "South Gate C to SW Perimeter Bypass",
        "source": "node_gate_c",
        "target": "node_perimeter_sw",
        "type": "ROAD",
        "length_meters": 330.0,
        "capacity_limit_pph": 2000,
        "base_flow_pph": 200,
    },
    {
        "id": "edge_bypass_gate_d_nw",
        "name": "West Gate D to NW Perimeter Bypass",
        "source": "node_gate_d",
        "target": "node_perimeter_nw",
        "type": "ROAD",
        "length_meters": 310.0,
        "capacity_limit_pph": 2000,
        "base_flow_pph": 200,
    },
]


class RoutingService:
    """Provides impedance-weighted route pathfinding, corridor blocking, and alternative discovery."""

    @classmethod
    def get_all_nodes(cls) -> List[NodeInfo]:
        """Returns all venue graph nodes with coordinates and labels."""
        raw_nodes = network_service.get_nodes()
        nodes = []
        for n in raw_nodes:
            nodes.append(
                NodeInfo(
                    id=n["id"],
                    name=n.get("name", n["id"]),
                    type=n.get("type", "JUNCTION"),
                    coordinates=n.get("coordinates", [0.0, 0.0]),
                    svg_pos=n.get("svg_pos", [0, 0]),
                    capacity_pax=n.get("capacity_pax"),
                )
            )
        return nodes

    @classmethod
    def get_node_by_id(cls, node_id: str) -> Optional[NodeInfo]:
        """Retrieves node metadata by node ID."""
        for n in cls.get_all_nodes():
            if n.id == node_id:
                return n
        return None

    @classmethod
    def get_all_base_edges(cls) -> List[Dict[str, Any]]:
        """Returns all base network edges plus perimeter bypass connectors."""
        edges = list(network_service.get_edges())
        edges.extend(PERIMETER_BYPASS_EDGES)
        return edges

    @classmethod
    def get_blocked_edge_ids(cls, db_path: Optional[str] = None) -> Set[str]:
        """Retrieves set of currently blocked edge IDs from database."""
        with get_db_read(db_path) as conn:
            cursor = conn.execute(
                "SELECT edge_id FROM blocked_edges WHERE is_blocked = 1;"
            )
            return {row["edge_id"] for row in cursor.fetchall()}

    @classmethod
    def get_edges_with_status(cls, db_path: Optional[str] = None) -> List[EdgeInfo]:
        """Returns list of all edges enriched with live blocked state and node coordinates."""
        base_edges = cls.get_all_base_edges()
        nodes_map = {n.id: n for n in cls.get_all_nodes()}

        with get_db_read(db_path) as conn:
            cursor = conn.execute(
                "SELECT edge_id, is_blocked, reason, blocked_by_name, updated_at FROM blocked_edges;"
            )
            blocked_map = {row["edge_id"]: dict(row) for row in cursor.fetchall()}

        result = []
        for e in base_edges:
            e_id = e["id"]
            b_info = blocked_map.get(e_id)
            is_blocked = bool(b_info["is_blocked"]) if b_info else False

            src_node = nodes_map.get(e["source"])
            tgt_node = nodes_map.get(e["target"])

            coords = None
            if src_node and tgt_node:
                coords = [src_node.coordinates, tgt_node.coordinates]

            result.append(
                EdgeInfo(
                    id=e_id,
                    name=e.get("name", e_id),
                    source=e["source"],
                    target=e["target"],
                    type=e.get("type", "WALKWAY"),
                    length_meters=float(e.get("length_meters", 100.0)),
                    capacity_limit_pph=int(e.get("capacity_limit_pph", 2000)),
                    is_blocked=is_blocked,
                    block_reason=b_info.get("reason") if (b_info and is_blocked) else None,
                    blocked_by_name=b_info.get("blocked_by_name") if (b_info and is_blocked) else None,
                    blocked_at=b_info.get("updated_at") if (b_info and is_blocked) else None,
                    source_name=src_node.name if src_node else e["source"],
                    target_name=tgt_node.name if tgt_node else e["target"],
                    coordinates=coords,
                )
            )
        return result

    @classmethod
    def block_edge(
        cls,
        edge_id: str,
        reason: str,
        operator_id: Optional[str] = None,
        operator_name: Optional[str] = None,
        source: str = "OPERATOR",
        db_path: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Marks an edge as blocked, preventing it from being used in emergency pathfinding.
        Records an immutable entry in blocked_edge_history.
        """
        all_edges = cls.get_all_base_edges()
        if not any(e["id"] == edge_id for e in all_edges):
            raise KeyError(f"Edge '{edge_id}' does not exist in venue topology.")

        now_utc = datetime.now(timezone.utc).isoformat()
        audit_id = str(uuid.uuid4())

        with get_db(db_path) as conn:
            conn.execute(
                """
                INSERT INTO blocked_edges (edge_id, is_blocked, reason, blocked_by, blocked_by_name, source, created_at, updated_at)
                VALUES (?, 1, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(edge_id) DO UPDATE SET
                    is_blocked = 1,
                    reason = excluded.reason,
                    blocked_by = excluded.blocked_by,
                    blocked_by_name = excluded.blocked_by_name,
                    source = excluded.source,
                    updated_at = excluded.updated_at;
                """,
                (edge_id, reason.strip(), operator_id, operator_name or "Operator", source, now_utc, now_utc),
            )

            conn.execute(
                """
                INSERT INTO blocked_edge_history (id, edge_id, action, reason, operator_id, operator_username, source, timestamp)
                VALUES (?, ?, 'BLOCK', ?, ?, ?, ?, ?);
                """,
                (audit_id, edge_id, reason.strip(), operator_id, operator_name or "Operator", source, now_utc),
            )

        logger.info("Blocked edge '%s': %s (by %s)", edge_id, reason, operator_name)
        return {
            "edge_id": edge_id,
            "is_blocked": True,
            "reason": reason.strip(),
            "blocked_by_name": operator_name or "Operator",
            "updated_at": now_utc,
        }

    @classmethod
    def reopen_edge(
        cls,
        edge_id: str,
        reason: str = "Cleared for traffic",
        operator_id: Optional[str] = None,
        operator_name: Optional[str] = None,
        db_path: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Reopens a blocked edge, restoring it to emergency pathfinding eligibility."""
        all_edges = cls.get_all_base_edges()
        if not any(e["id"] == edge_id for e in all_edges):
            raise KeyError(f"Edge '{edge_id}' does not exist in venue topology.")

        now_utc = datetime.now(timezone.utc).isoformat()
        audit_id = str(uuid.uuid4())

        with get_db(db_path) as conn:
            conn.execute(
                """
                UPDATE blocked_edges
                SET is_blocked = 0, reason = ?, updated_at = ?
                WHERE edge_id = ?;
                """,
                (reason.strip(), now_utc, edge_id),
            )

            conn.execute(
                """
                INSERT INTO blocked_edge_history (id, edge_id, action, reason, operator_id, operator_username, source, timestamp)
                VALUES (?, ?, 'REOPEN', ?, ?, ?, 'OPERATOR', ?);
                """,
                (audit_id, edge_id, reason.strip(), operator_id, operator_name or "Operator", now_utc),
            )

        logger.info("Reopened edge '%s': %s (by %s)", edge_id, reason, operator_name)
        return {
            "edge_id": edge_id,
            "is_blocked": False,
            "reason": reason.strip(),
            "updated_at": now_utc,
        }

    @classmethod
    def get_edge_history(cls, edge_id: str, db_path: Optional[str] = None) -> List[BlockedEdgeAuditRecord]:
        """Retrieves chronological audit history for a specific edge."""
        with get_db_read(db_path) as conn:
            cursor = conn.execute(
                """
                SELECT id, edge_id, action, reason, operator_username, source, timestamp
                FROM blocked_edge_history
                WHERE edge_id = ?
                ORDER BY timestamp DESC;
                """,
                (edge_id,),
            )
            return [BlockedEdgeAuditRecord(**dict(row)) for row in cursor.fetchall()]

    @classmethod
    def _build_routing_graph(cls, blocked_ids: Set[str]) -> nx.Graph:
        """
        Builds an undirected NetworkX graph with length weights,
        strictly omitting edges currently marked as blocked.
        """
        G = nx.Graph()
        nodes_map = {n.id: n for n in cls.get_all_nodes()}

        for n_id, node in nodes_map.items():
            G.add_node(n_id, name=node.name, coordinates=node.coordinates)

        for edge in cls.get_all_base_edges():
            e_id = edge["id"]
            if e_id in blocked_ids:
                continue

            u = edge["source"]
            v = edge["target"]
            length = float(edge.get("length_meters", 100.0))

            G.add_edge(
                u,
                v,
                id=e_id,
                name=edge.get("name", e_id),
                type=edge.get("type", "WALKWAY"),
                length_meters=length,
            )
        return G

    @classmethod
    def calculate_route(
        cls,
        origin_id: str,
        destination_id: str,
        max_alternatives: int = 2,
        walking_speed_mps: float = DEFAULT_WALKING_SPEED_MPS,
        simulated_blocked_edges: Optional[List[str]] = None,
        db_path: Optional[str] = None,
    ) -> RouteCalculationResponse:
        """
        Calculates the optimal cleared emergency corridor and alternatives between two nodes.
        Excludes all currently blocked edges and any ephemeral simulated blocked edges.
        """
        nodes_map = {n.id: n for n in cls.get_all_nodes()}
        origin_node = nodes_map.get(origin_id)
        dest_node = nodes_map.get(destination_id)

        if not origin_node:
            raise KeyError(f"Origin node '{origin_id}' not found in venue topology.")
        if not dest_node:
            raise KeyError(f"Destination node '{destination_id}' not found in venue topology.")

        if origin_id == destination_id:
            return RouteCalculationResponse(
                origin_id=origin_id,
                origin_name=origin_node.name,
                destination_id=destination_id,
                destination_name=dest_node.name,
                status="FOUND",
                primary_route=CalculatedRoute(
                    route_index=0,
                    route_name="Current Location",
                    total_distance_meters=0.0,
                    estimated_travel_time_sec=0.0,
                    estimated_travel_time_minutes=0.0,
                    walking_speed_mps=walking_speed_mps,
                    node_path=[origin_id],
                    edge_path=[],
                    segments=[],
                    status="OPTIMAL",
                ),
            )

        blocked_ids = cls.get_blocked_edge_ids(db_path=db_path)
        if simulated_blocked_edges:
            blocked_ids = blocked_ids.union(set(simulated_blocked_edges))

        G = cls._build_routing_graph(blocked_ids)

        # Check if connected
        if not nx.has_path(G, origin_id, destination_id):
            disclaimer = "No cleared corridor available. Selected route is compromised by active edge blockages."
            if simulated_blocked_edges:
                disclaimer += " (Includes ephemeral Scenario Lab closures)."
            return RouteCalculationResponse(
                origin_id=origin_id,
                origin_name=origin_node.name,
                destination_id=destination_id,
                destination_name=dest_node.name,
                status="NO_PATH_AVAILABLE",
                blocked_edges_encountered=list(blocked_ids),
                disclaimer=disclaimer,
            )

        # Compute k-shortest paths via NetworkX
        paths_generator = nx.shortest_simple_paths(G, origin_id, destination_id, weight="length_meters")
        found_routes: List[CalculatedRoute] = []

        try:
            for idx, node_path in enumerate(paths_generator):
                if idx > max_alternatives:
                    break

                # Extract edge segments and calculate distance
                segments: List[RouteSegment] = []
                edge_path: List[str] = []
                total_distance = 0.0

                for i in range(len(node_path) - 1):
                    u = node_path[i]
                    v = node_path[i + 1]
                    edge_data = G.get_edge_data(u, v)

                    e_id = edge_data["id"]
                    e_name = edge_data.get("name", e_id)
                    length = edge_data.get("length_meters", 100.0)

                    u_node = nodes_map[u]
                    v_node = nodes_map[v]

                    edge_path.append(e_id)
                    total_distance += length

                    segments.append(
                        RouteSegment(
                            edge_id=e_id,
                            edge_name=e_name,
                            source_id=u,
                            source_name=u_node.name,
                            target_id=v,
                            target_name=v_node.name,
                            length_meters=length,
                            coordinates=[u_node.coordinates, v_node.coordinates],
                        )
                    )

                travel_sec = total_distance / walking_speed_mps if walking_speed_mps > 0 else 0.0
                travel_min = round(travel_sec / 60.0, 1)
                route_name = "Primary Cleared Corridor" if idx == 0 else f"Bypass Alternative #{idx}"
                status = "OPTIMAL" if idx == 0 else "ALTERNATIVE"

                found_routes.append(
                    CalculatedRoute(
                        route_index=idx,
                        route_name=route_name,
                        total_distance_meters=round(total_distance, 1),
                        estimated_travel_time_sec=round(travel_sec, 1),
                        estimated_travel_time_minutes=travel_min,
                        walking_speed_mps=walking_speed_mps,
                        node_path=node_path,
                        edge_path=edge_path,
                        segments=segments,
                        status=status,
                    )
                )
        except Exception as e:
            logger.error("Error generating alternative paths: %s", e)

        primary = found_routes[0] if found_routes else None
        alternatives = found_routes[1:] if len(found_routes) > 1 else []

        return RouteCalculationResponse(
            origin_id=origin_id,
            origin_name=origin_node.name,
            destination_id=destination_id,
            destination_name=dest_node.name,
            status="FOUND",
            primary_route=primary,
            alternative_routes=alternatives,
            blocked_edges_encountered=list(blocked_ids),
        )
