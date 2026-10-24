"""
Darshini - Road & Pedestrian Network Topology Service
Loads venue topology into a NetworkX directed graph model for flow simulation,
capacity bottleneck analysis, and emergency pathfinding.
"""

import json
import logging
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple
import networkx as nx

from app.config import BACKEND_DIR

logger = logging.getLogger("darshini.network_service")
DEFAULT_NETWORK_PATH = BACKEND_DIR / "app" / "data" / "road_network.json"


class NetworkTopologyError(Exception):
    """Raised when network topology file is missing, invalid, or disconnected."""
    pass


class NetworkService:
    """Manages the NetworkX representation of the precinct road and corridor network."""

    def __init__(self, data_path: Path = DEFAULT_NETWORK_PATH):
        self.data_path = Path(data_path)
        self._graph: Optional[nx.DiGraph] = None
        self._raw_data: Optional[Dict[str, Any]] = None
        self._load_network()

    def _load_network(self) -> None:
        """Loads node-link topology from disk and builds the NetworkX graph."""
        if not self.data_path.exists():
            raise NetworkTopologyError(f"Network topology file not found at '{self.data_path}'")

        try:
            with open(self.data_path, "r", encoding="utf-8") as f:
                self._raw_data = json.load(f)
        except Exception as e:
            raise NetworkTopologyError(f"Failed to parse network topology JSON: {e}")

        G = nx.DiGraph()

        # Add Nodes
        for node in self._raw_data.get("nodes", []):
            n_id = node["id"]
            G.add_node(
                n_id,
                name=node.get("name", n_id),
                type=node.get("type", "JUNCTION"),
                coordinates=node.get("coordinates", [0.0, 0.0]),
                svg_pos=node.get("svg_pos", [0, 0]),
                base_inflow_pph=node.get("base_inflow_pph", 0),
                capacity_pax=node.get("capacity_pax", 1000),
            )

        # Add Edges
        for edge in self._raw_data.get("edges", []):
            u = edge["source"]
            v = edge["target"]
            e_id = edge["id"]
            G.add_edge(
                u,
                v,
                id=e_id,
                name=edge.get("name", e_id),
                type=edge.get("type", "WALKWAY"),
                length_meters=float(edge.get("length_meters", 100.0)),
                capacity_limit_pph=int(edge.get("capacity_limit_pph", 2000)),
                base_flow_pph=int(edge.get("base_flow_pph", 1000)),
                svg_coords=edge.get("svg_coords", [0, 0, 0, 0]),
                is_blocked=False,
            )

        self._graph = G
        logger.info(
            "Successfully initialized NetworkX graph '%s' with %d nodes and %d edges.",
            self._raw_data.get("venue_name", "Venue"),
            G.number_of_nodes(),
            G.number_of_edges(),
        )

    @property
    def graph(self) -> nx.DiGraph:
        """Returns the active NetworkX graph."""
        if self._graph is None:
            self._load_network()
        return self._graph

    @property
    def raw_data(self) -> Dict[str, Any]:
        """Returns the raw venue topology dictionary."""
        if self._raw_data is None:
            self._load_network()
        return self._raw_data

    def get_nodes(self) -> List[Dict[str, Any]]:
        """Returns list of all nodes with attributes."""
        nodes = []
        for n_id, attrs in self.graph.nodes(data=True):
            nodes.append({
                "id": n_id,
                **attrs,
            })
        return nodes

    def get_edges(self) -> List[Dict[str, Any]]:
        """Returns list of all edges with attributes."""
        edges = []
        for u, v, attrs in self.graph.edges(data=True):
            edges.append({
                "source": u,
                "target": v,
                **attrs,
            })
        return edges

    def get_edge_by_id(self, edge_id: str) -> Optional[Dict[str, Any]]:
        """Finds edge attributes by its unique ID."""
        for u, v, attrs in self.graph.edges(data=True):
            if attrs.get("id") == edge_id:
                return {"source": u, "target": v, **attrs}
        return None

    def clone_graph(self) -> nx.DiGraph:
        """Returns a deep copy of the graph for simulation isolation."""
        return self.graph.copy()


# Global singleton instance
network_service = NetworkService()
