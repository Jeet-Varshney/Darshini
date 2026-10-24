"""
Darshini - Milestone 3: Digital Twin & NetworkX Simulation Engine Tests
Tests for:
- What-if simulation endpoint (POST /api/v1/simulation/run)
- Baseline (1.0x) vs. Crowd Multiplier (2.0x) capacity saturation
- Gate overrides (OPEN, RESTRICTED, CLOSED)
- Road closures and corridor blocking
- Perimeter traffic diversion effectiveness
- Network topology endpoint (GET /api/v1/simulation/network)
- Performance latency (< 250 ms target)
- Input parameter validation
"""

import time
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.network_service import network_service
from app.services.simulation_service import simulation_service


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


def test_network_service_graph_initialization():
    """Verify NetworkX graph builds successfully with nodes and edges."""
    G = network_service.graph
    assert G.number_of_nodes() >= 9
    assert G.number_of_edges() >= 10

    # Verify key nodes exist
    assert "node_gate_a" in G.nodes
    assert "node_central_promenade" in G.nodes
    assert "node_south_terminal" in G.nodes

    # Verify edge attributes
    u, v, attrs = next(iter(G.edges(data=True)))
    assert "capacity_limit_pph" in attrs
    assert "base_flow_pph" in attrs
    assert attrs["capacity_limit_pph"] > 0


def test_simulation_endpoint_baseline(client):
    """Verify POST /api/v1/simulation/run returns valid baseline schema and completes in under 250ms."""
    t0 = time.perf_counter()
    response = client.post(
        "/api/v1/simulation/run",
        json={"inflow_multiplier": 1.0, "duration_minutes": 60},
    )
    t1 = time.perf_counter()
    wall_clock_ms = (t1 - t0) * 1000

    assert response.status_code == 200
    data = response.json()

    assert data["status"] == "COMPLETED"
    assert data["inflow_multiplier"] == 1.0
    assert "scenario_id" in data
    assert "baseline_comparison" in data
    assert "projected_edge_loads" in data
    assert "network_nodes" in data
    assert "warnings" in data
    assert "data_provenance" in data

    # Verify execution latency requirement: < 250 ms
    assert data["execution_time_ms"] < 250.0
    assert wall_clock_ms < 250.0

    # In baseline (1.0x), no corridors should be in critical breach (>85%)
    assert data["baseline_comparison"]["projected_critical_bottlenecks"] == 0


def test_crowd_multiplier_1_0x_vs_2_0x_saturation(client):
    """
    Verify that increasing crowd multiplier from 1.0x to 2.0x demonstrates
    clear capacity saturation and triggers bottleneck warnings.
    """
    # 1. Baseline 1.0x
    res_1x = client.post(
        "/api/v1/simulation/run",
        json={"inflow_multiplier": 1.0, "scenario_name": "Baseline Test"},
    )
    assert res_1x.status_code == 200
    data_1x = res_1x.json()

    # 2. Surge 2.0x
    res_2x = client.post(
        "/api/v1/simulation/run",
        json={"inflow_multiplier": 2.0, "scenario_name": "Peak Surge Test"},
    )
    assert res_2x.status_code == 200
    data_2x = res_2x.json()

    # Compare metrics
    base_util = data_2x["baseline_comparison"]["baseline_avg_utilization_pct"]
    proj_util = data_2x["baseline_comparison"]["projected_avg_utilization_pct"]
    assert proj_util > base_util + 35.0, f"Expected >35% increase in utilization, got {base_util} -> {proj_util}"

    # Critical bottlenecks must increase visibly from 0 at 1.0x to >= 2 at 2.0x
    assert data_1x["baseline_comparison"]["projected_critical_bottlenecks"] == 0
    assert data_2x["baseline_comparison"]["projected_critical_bottlenecks"] >= 2
    assert data_2x["baseline_comparison"]["network_flow_status"] == "CRITICAL_SATURATION"

    # Specific corridor breach checks (North Spine Walkway and South Spine)
    edge_loads_2x = {e["edge_id"]: e for e in data_2x["projected_edge_loads"]}
    assert "edge_north_spine" in edge_loads_2x
    assert edge_loads_2x["edge_north_spine"]["utilization_pct"] > 85.0
    assert edge_loads_2x["edge_north_spine"]["breach_predicted"] is True
    assert edge_loads_2x["edge_north_spine"]["saturation_status"] == "CRITICAL"

    # Warnings must contain explicit text for breached corridors
    warnings = " ".join(data_2x["warnings"])
    assert "CAPACITY BREACH" in warnings
    assert "North Spine Concourse Walkway" in warnings


def test_gate_overrides_closed(client):
    """Verify closing a gate stops inflow on that gate access edge."""
    res = client.post(
        "/api/v1/simulation/run",
        json={
            "inflow_multiplier": 1.0,
            "gate_overrides": {"node_gate_b": "CLOSED"},
        },
    )
    assert res.status_code == 200
    data = res.json()

    edge_loads = {e["edge_id"]: e for e in data["projected_edge_loads"]}
    assert edge_loads["edge_pavilion_gate_b"]["simulated_flow_pph"] == 0
    assert edge_loads["edge_pavilion_gate_b"]["utilization_pct"] == 0.0


def test_road_closures(client):
    """Verify closing a road segment blocks the edge and zeros its throughput."""
    res = client.post(
        "/api/v1/simulation/run",
        json={
            "inflow_multiplier": 1.0,
            "road_closures": ["edge_west_emergency"],
        },
    )
    assert res.status_code == 200
    data = res.json()

    edge_loads = {e["edge_id"]: e for e in data["projected_edge_loads"]}
    assert edge_loads["edge_west_emergency"]["is_blocked"] is True
    assert edge_loads["edge_west_emergency"]["capacity_limit_pph"] == 0
    assert edge_loads["edge_west_emergency"]["simulated_flow_pph"] == 0


def test_traffic_diversion_reduces_central_spine_load(client):
    """Verify diverting 40% flow to perimeter reduces central concourse spine utilization."""
    res_direct = client.post(
        "/api/v1/simulation/run",
        json={"inflow_multiplier": 1.5, "traffic_diversion_pct": 0.0},
    )
    res_diverted = client.post(
        "/api/v1/simulation/run",
        json={"inflow_multiplier": 1.5, "traffic_diversion_pct": 40.0},
    )
    assert res_direct.status_code == 200
    assert res_diverted.status_code == 200

    direct_loads = {e["edge_id"]: e for e in res_direct.json()["projected_edge_loads"]}
    diverted_loads = {e["edge_id"]: e for e in res_diverted.json()["projected_edge_loads"]}

    # Central spine load must be lower with diversion
    assert (
        diverted_loads["edge_north_spine"]["simulated_flow_pph"]
        < direct_loads["edge_north_spine"]["simulated_flow_pph"]
    )


def test_get_network_topology_endpoint(client):
    """Verify GET /api/v1/simulation/network returns complete venue topology."""
    response = client.get("/api/v1/simulation/network")
    assert response.status_code == 200
    data = response.json()

    assert "venue_id" in data
    assert "nodes" in data
    assert "edges" in data
    assert len(data["nodes"]) >= 9
    assert len(data["edges"]) >= 10

    first_node = data["nodes"][0]
    assert "id" in first_node
    assert "type" in first_node
    assert "coordinates" in first_node
    assert "svg_pos" in first_node


def test_simulation_validation_errors(client):
    """Verify input validation rejects invalid parameter bounds."""
    # Multiplier too small (< 0.1)
    res_low = client.post(
        "/api/v1/simulation/run",
        json={"inflow_multiplier": -1.0},
    )
    assert res_low.status_code == 422

    # Multiplier too large (> 5.0)
    res_high = client.post(
        "/api/v1/simulation/run",
        json={"inflow_multiplier": 10.0},
    )
    assert res_high.status_code == 422


def test_simulation_benchmark_latency():
    """Verify 10 repeated simulations consistently execute under 250ms."""
    durations = []
    for _ in range(10):
        t0 = time.perf_counter()
        res = simulation_service.run_simulation(inflow_multiplier=2.0)
        t1 = time.perf_counter()
        ms = (t1 - t0) * 1000
        durations.append(ms)
        assert res["status"] == "COMPLETED"

    avg_ms = sum(durations) / len(durations)
    max_ms = max(durations)
    assert max_ms < 250.0, f"Max execution time was {max_ms:.2f} ms (target < 250 ms)"
    assert avg_ms < 50.0, f"Avg execution time was {avg_ms:.2f} ms"


def test_simulation_alias_parameters(client):
    """Verify alias parameter names (crowd_multiplier, closed_road_ids, gate_b_override) work seamlessly."""
    res = client.post(
        "/api/v1/simulation/run",
        json={
            "crowd_multiplier": 2.0,
            "gate_b_override": "RESTRICTED",
            "closed_road_ids": ["edge_north_ring"],
            "traffic_diversion_pct": 25.0,
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "COMPLETED"
    assert data["inflow_multiplier"] == 2.0
    edge_map = {e["edge_id"]: e for e in data["projected_edge_loads"]}
    assert edge_map["edge_north_ring"]["is_blocked"] is True
    # Gate B is restricted (50% flow)
    assert edge_map["edge_pavilion_gate_b"]["simulated_flow_pph"] == int(1100 * 2.0 * 0.5)
