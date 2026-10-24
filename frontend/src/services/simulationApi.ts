import { API_BASE_URL } from './detectionApi';
import type {
  SimulationRunRequest,
  SimulationRunResponse,
  NetworkTopologyResponse,
} from '../types/simulation';

/**
 * Fetch static/base road & corridor network topology from backend NetworkX service
 */
export async function fetchNetworkTopology(): Promise<NetworkTopologyResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/simulation/network`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`Failed to load network topology (HTTP ${res.status})`);
    }

    return await res.json();
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error(`Connection timed out fetching network topology from ${API_BASE_URL}`);
    }
    throw new Error(err.message || 'Cannot connect to Darshini simulation service');
  }
}

/**
 * Run what-if crowd flow simulation via NetworkX engine
 */
export async function runSimulation(
  params: SimulationRunRequest
): Promise<SimulationRunResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);

  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/simulation/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      let errMsg = `Simulation execution failed (HTTP ${res.status})`;
      try {
        const errorData = await res.json();
        if (errorData?.detail) {
          errMsg = typeof errorData.detail === 'string'
            ? errorData.detail
            : JSON.stringify(errorData.detail);
        }
      } catch {
        // use default errMsg
      }
      throw new Error(errMsg);
    }

    return await res.json();
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error(`Simulation request timed out contacting ${API_BASE_URL}`);
    }
    throw new Error(err.message || 'Simulation service unavailable');
  }
}
