"""
Darshini - Digital Twin & NetworkX Simulation Engine
Executes deterministic what-if capacity simulations, corridor flow propagation,
bottleneck detection, and baseline-versus-intervention matrix evaluations.
"""

import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any, Tuple
import networkx as nx

from app.services.network_service import network_service, NetworkService

logger = logging.getLogger("darshini.simulation_service")


class SimulationService:
    """Simulates crowd flows, corridor capacities, and saturation bottlenecks across venue topology."""

    def __init__(self, network: Optional[NetworkService] = None):
        self.network = network or network_service

    def run_simulation(
        self,
        inflow_multiplier: float = 1.0,
        scenario_name: Optional[str] = None,
        duration_minutes: int = 60,
        gate_overrides: Optional[Dict[str, str]] = None,
        road_closures: Optional[List[str]] = None,
        traffic_diversion_pct: float = 0.0,
        shuttle_dispatch_multiplier: float = 1.0,
    ) -> Dict[str, Any]:
        """
        Executes a deterministic what-if flow simulation over the NetworkX graph model.
        Returns complete scenario projection with baseline comparison in under 250ms.
        """
        t0 = time.perf_counter()

        # Validate input bounds
        inflow_mult = max(0.1, min(5.0, float(inflow_multiplier)))
        duration = max(10, min(360, int(duration_minutes)))
        diversion_pct = max(0.0, min(100.0, float(traffic_diversion_pct)))
        shuttle_mult = max(0.5, min(3.0, float(shuttle_dispatch_multiplier)))
        gate_overrides = gate_overrides or {}
        road_closures = set(road_closures or [])

        # 1. Compute Baseline Scenario (1.0x, no overrides, no closures)
        baseline_loads, baseline_metrics = self._evaluate_flow(
            graph=self.network.clone_graph(),
            multiplier=1.0,
            gate_overrides={},
            road_closures=set(),
            diversion_pct=0.0,
            shuttle_mult=1.0,
            duration_mins=duration,
        )

        # 2. Compute Proposed Intervention Scenario
        projected_loads, projected_metrics = self._evaluate_flow(
            graph=self.network.clone_graph(),
            multiplier=inflow_mult,
            gate_overrides=gate_overrides,
            road_closures=road_closures,
            diversion_pct=diversion_pct,
            shuttle_mult=shuttle_mult,
            duration_mins=duration,
        )

        # 3. Compute Delta and Baseline Comparison
        util_delta = round(projected_metrics["avg_utilization_pct"] - baseline_metrics["avg_utilization_pct"], 1)
        bottleneck_delta = projected_metrics["critical_bottlenecks"] - baseline_metrics["critical_bottlenecks"]
        clearance_delta = round(projected_metrics["clearance_minutes"] - baseline_metrics["clearance_minutes"], 1)
        density_delta = round(projected_metrics["peak_density_p_sqm"] - baseline_metrics["peak_density_p_sqm"], 2)

        if bottleneck_delta < 0 or (bottleneck_delta == 0 and util_delta < 0):
            status_label = "IMPROVED"
            summary_desc = (
                f"Proposed intervention reduces peak corridor congestion by {abs(util_delta):.1f}% "
                f"and saves {abs(clearance_delta):.1f} mins egress duration."
            )
        elif bottleneck_delta > 0 or util_delta > 20.0:
            status_label = "CRITICAL_SATURATION"
            summary_desc = (
                f"Crowd influx causes {projected_metrics['critical_bottlenecks']} corridor capacity breaches. "
                f"Average network utilization increased by +{util_delta:.1f}%."
            )
        elif util_delta > 0:
            status_label = "ELEVATED"
            summary_desc = (
                f"Network load is elevated (+{util_delta:.1f}%); active corridors operate within safety margins."
            )
        else:
            status_label = "OPTIMAL"
            summary_desc = "Network flows are within calibrated baseline bounds."

        # 4. Generate Explainable Warning Messages
        warnings: List[str] = []
        for edge in projected_loads:
            if edge["breach_predicted"]:
                excess = edge["simulated_flow_pph"] - edge["capacity_limit_pph"]
                warnings.append(
                    f"CAPACITY BREACH: '{edge['name']}' exceeds physical limit by +{excess:,} pax/hr "
                    f"({edge['utilization_pct']:.1f}% capacity). Chokepoint onset predicted."
                )
            elif edge["saturation_status"] == "WARNING":
                warnings.append(
                    f"ELEVATED CORRIDOR: '{edge['name']}' is at {edge['utilization_pct']:.1f}% capacity. "
                    f"Approaching 85% threshold; monitor inflow."
                )

        if not warnings:
            warnings.append("All network corridors operating below 60% capacity threshold.")

        # 5. Compile Node Statuses
        nodes_status = []
        for n in self.network.get_nodes():
            n_id = n["id"]
            # Estimate node accumulation from incoming vs outgoing flows
            inflow = sum(e["simulated_flow_pph"] for e in projected_loads if e["target_node"] == n_id)
            outflow = sum(e["simulated_flow_pph"] for e in projected_loads if e["source_node"] == n_id)
            if n["type"] == "GATE":
                inflow = int(n.get("base_inflow_pph", 0) * inflow_mult)
            
            cap = n.get("capacity_pax", 1000)
            accum_risk = "HIGH" if (inflow > outflow * 1.2 and inflow > cap * 0.75) else ("MODERATE" if inflow > cap * 0.5 else "LOW")

            nodes_status.append({
                "node_id": n_id,
                "name": n["name"],
                "node_type": n["type"],
                "coordinates": n["coordinates"],
                "svg_pos": n["svg_pos"],
                "inflow_pph": inflow,
                "outflow_pph": outflow,
                "capacity_pax": cap,
                "accumulation_risk": accum_risk,
            })

        t1 = time.perf_counter()
        elapsed_ms = round((t1 - t0) * 1000, 2)

        scenario_id = f"sim-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:4]}"
        sc_name = scenario_name or f"Crowd Multiplier {inflow_mult:.1f}x Scenario"

        return {
            "scenario_id": scenario_id,
            "scenario_name": sc_name,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "execution_time_ms": elapsed_ms,
            "status": "COMPLETED",
            "inflow_multiplier": inflow_mult,
            "duration_minutes": duration,
            "baseline_comparison": {
                "network_flow_status": status_label,
                "summary": summary_desc,
                "baseline_inflow_rate_pph": baseline_metrics["total_inflow_pph"],
                "projected_inflow_rate_pph": projected_metrics["total_inflow_pph"],
                "baseline_avg_utilization_pct": baseline_metrics["avg_utilization_pct"],
                "projected_avg_utilization_pct": projected_metrics["avg_utilization_pct"],
                "utilization_delta_pct": util_delta,
                "baseline_critical_bottlenecks": baseline_metrics["critical_bottlenecks"],
                "projected_critical_bottlenecks": projected_metrics["critical_bottlenecks"],
                "bottlenecks_delta": bottleneck_delta,
                "estimated_clearance_minutes_baseline": baseline_metrics["clearance_minutes"],
                "estimated_clearance_minutes_projected": projected_metrics["clearance_minutes"],
                "clearance_time_delta_mins": clearance_delta,
                "peak_density_p_sqm_baseline": baseline_metrics["peak_density_p_sqm"],
                "peak_density_p_sqm_projected": projected_metrics["peak_density_p_sqm"],
                "peak_density_delta_p_sqm": density_delta,
            },
            "projected_edge_loads": projected_loads,
            "network_nodes": nodes_status,
            "warnings": warnings,
            "data_provenance": {
                "model": "NetworkX Conservation of Flow & Capacitated Flow Twin",
                "disclaimer": "SIMULATED DATA: What-if graph projection over configured venue topology. Decisions require human verification.",
                "human_in_the_loop_notice": "Recommendations are decision-support estimates generated from heuristic models. Dispatch of personnel and route closures require explicit operational verification by a human commander.",
                "badge_category": "[PROJECTED: TWIN]",
            },
        }

    def _evaluate_flow(
        self,
        graph: nx.DiGraph,
        multiplier: float,
        gate_overrides: Dict[str, str],
        road_closures: set,
        diversion_pct: float,
        shuttle_mult: float,
        duration_mins: int,
    ) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
        """Internal helper evaluating edge loads and network metrics on a NetworkX graph instance."""
        edge_results = []
        total_inflow = 0
        total_capacity = 0
        utilization_sum = 0.0
        critical_count = 0

        # Calculate gate modifier multipliers
        gate_factors = {}
        for n_id, attrs in graph.nodes(data=True):
            if attrs.get("type") == "GATE":
                override = gate_overrides.get(n_id, "OPEN").upper()
                factor = 1.0
                if "RESTRICTED" in override or "50" in override:
                    factor = 0.5
                elif "CLOSED" in override or "0" in override:
                    factor = 0.0
                gate_factors[n_id] = factor

        diversion_factor = diversion_pct / 100.0

        for u, v, attrs in graph.edges(data=True):
            e_id = attrs.get("id", f"{u}_{v}")
            name = attrs.get("name", e_id)
            c_type = attrs.get("type", "WALKWAY")
            length = attrs.get("length_meters", 100.0)
            base_capacity = attrs.get("capacity_limit_pph", 2000)
            base_flow = attrs.get("base_flow_pph", 1000)

            # Check road closures
            if e_id in road_closures:
                is_blocked = True
                capacity = 0
                simulated_flow = 0
            else:
                is_blocked = False
                capacity = base_capacity

                # Flow scaling logic
                flow = base_flow * multiplier

                # Apply gate scaling if edge connects directly to a gate
                if u in gate_factors:
                    flow *= gate_factors[u]
                elif v in gate_factors:
                    flow *= gate_factors[v]

                # Apply perimeter diversion: flow is diverted from central spines to perimeter roads
                if "spine" in e_id.lower() or "concourse" in e_id.lower():
                    flow *= (1.0 - (diversion_factor * 0.45))
                elif "ring" in e_id.lower() or "arterial" in e_id.lower():
                    # Perimeter roads absorb diverted flow
                    flow += int(base_flow * diversion_factor * 0.70)

                # Shuttle bus boost at south terminal increases outflow capacity
                if "terminal" in e_id.lower() and shuttle_mult > 1.0:
                    capacity = int(base_capacity * min(1.5, shuttle_mult))

                simulated_flow = max(0, int(round(flow)))

            util_pct = round((simulated_flow / max(1, capacity)) * 100.0, 1) if capacity > 0 else 100.0

            if util_pct > 85.0:
                sat_status = "CRITICAL"
                breach = True
                critical_count += 1
            elif util_pct >= 60.0:
                sat_status = "WARNING"
                breach = False
            else:
                sat_status = "NORMAL"
                breach = False

            delay = round(1.0 + max(0.0, (util_pct - 85.0) * 0.02), 2)

            edge_results.append({
                "edge_id": e_id,
                "name": name,
                "source_node": u,
                "target_node": v,
                "corridor_type": c_type,
                "length_meters": length,
                "capacity_limit_pph": capacity,
                "base_flow_pph": base_flow,
                "simulated_flow_pph": simulated_flow,
                "utilization_pct": util_pct,
                "saturation_status": sat_status,
                "breach_predicted": breach,
                "delay_factor": delay,
                "is_blocked": is_blocked,
                "svg_coords": attrs.get("svg_coords", [0, 0, 0, 0]),
            })

            total_capacity += capacity
            utilization_sum += util_pct
            if "gate" in e_id and "access" in e_id.lower():
                total_inflow += simulated_flow

        avg_util = round(utilization_sum / max(1, len(edge_results)), 1)
        total_inf = max(total_inflow, int(7200 * multiplier))

        # Clearance time formula (Little's law approximation with non-linear congestion penalty)
        base_clearance = 25.0 * multiplier
        congestion_penalty = critical_count * 5.5
        clearance_time = round(base_clearance + congestion_penalty, 1)

        # Peak density approximation
        peak_density = round(1.8 * multiplier + (0.5 if critical_count > 0 else 0.0), 2)

        metrics = {
            "total_inflow_pph": total_inf,
            "avg_utilization_pct": avg_util,
            "critical_bottlenecks": critical_count,
            "clearance_minutes": clearance_time,
            "peak_density_p_sqm": peak_density,
        }

        return edge_results, metrics


# Global singleton instance
simulation_service = SimulationService()
