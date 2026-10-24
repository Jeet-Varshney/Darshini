/**
 * Darshini - Emergency Routing API Client
 */

import type {
  BlockedEdgeAuditRecord,
  EdgeInfo,
  NodeInfo,
  RouteCalculationResponse,
} from '../types/routing';
import { getStoredToken } from './eventApi';

async function req<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    let err = `Request failed: ${response.status}`;
    try {
      const data = await response.json();
      if (data.detail) err = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail);
    } catch {}
    throw new Error(err);
  }
  return response.json();
}

export async function fetchRoutingNodes(): Promise<NodeInfo[]> {
  return req<NodeInfo[]>('/api/v1/routing/nodes');
}

export async function fetchRoutingEdges(): Promise<EdgeInfo[]> {
  return req<EdgeInfo[]>('/api/v1/routing/edges');
}

export async function calculateEmergencyRoute(
  origin: string,
  destination: string,
  maxAlternatives: number = 2,
  simulatedBlockedEdges?: string[]
): Promise<RouteCalculationResponse> {
  return req<RouteCalculationResponse>('/api/v1/routing/calculate', {
    method: 'POST',
    body: JSON.stringify({
      origin,
      destination,
      max_alternatives: maxAlternatives,
      simulated_blocked_edges: simulatedBlockedEdges && simulatedBlockedEdges.length > 0 ? simulatedBlockedEdges : undefined,
    }),
  });
}

export async function blockRoutingEdge(edgeId: string, reason: string, source: string = 'OPERATOR'): Promise<any> {
  return req<any>(`/api/v1/routing/edges/${encodeURIComponent(edgeId)}/block`, {
    method: 'POST',
    body: JSON.stringify({ reason, source }),
  });
}

export async function reopenRoutingEdge(edgeId: string, reason: string = 'Cleared for traffic'): Promise<any> {
  return req<any>(`/api/v1/routing/edges/${encodeURIComponent(edgeId)}/reopen`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export async function fetchEdgeHistory(edgeId: string): Promise<BlockedEdgeAuditRecord[]> {
  return req<BlockedEdgeAuditRecord[]>(`/api/v1/routing/edges/${encodeURIComponent(edgeId)}/history`);
}
