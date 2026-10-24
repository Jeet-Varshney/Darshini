/**
 * Darshini - Emergency Routing & Corridor Solver Screen
 * Calculates shortest cleared corridors, handles blocked edge operations, and visualizes route alternatives.
 * Features dual GIS Leaflet Map & Vector Schematic views, lifecycle-safe resizing, and operator audit trails.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { FICTIONAL_VENUE } from '../data/fictionalVenue';
import type {
  CalculatedRoute,
  EdgeInfo,
  NodeInfo,
  RouteCalculationResponse,
  BlockedEdgeAuditRecord,
} from '../types/routing';
import type { UserProfile } from '../types/events';
import {
  blockRoutingEdge,
  calculateEmergencyRoute,
  fetchEdgeHistory,
  fetchRoutingEdges,
  fetchRoutingNodes,
  reopenRoutingEdge,
} from '../services/routingApi';
import {
  getStoredUser,
  getStoredToken,
  setStoredToken,
  clearStoredToken,
  login,
} from '../services/eventApi';

interface EmergencyRoutingScreenProps {
  initialEdgeId?: string | null;
}

export const EmergencyRoutingScreen: React.FC<EmergencyRoutingScreenProps> = ({ initialEdgeId }) => {
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [edges, setEdges] = useState<EdgeInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Map view mode
  const [viewMode, setViewMode] = useState<'tiles' | 'schematic'>('tiles');

  // Origin & Destination selection
  const [originId, setOriginId] = useState<string>('node_gate_a');
  const [destinationId, setDestinationId] = useState<string>('node_pavilion_east');

  // Calculation outcome
  const [calculating, setCalculating] = useState<boolean>(false);
  const [routeResult, setRouteResult] = useState<RouteCalculationResponse | null>(null);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState<number>(0);

  // Block modal state
  const [blockingEdgeId, setBlockingEdgeId] = useState<string | null>(null);
  const [blockReason, setBlockReason] = useState<string>('');
  const [edgeFilter, setEdgeFilter] = useState<string>('');

  // Audit history modal state
  const [historyEdgeId, setHistoryEdgeId] = useState<string | null>(null);
  const [historyRecords, setHistoryRecords] = useState<BlockedEdgeAuditRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);

  // Operator Auth state
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(getStoredUser());
  const [showAuthModal, setShowAuthModal] = useState<boolean>(false);
  const [authUsername, setAuthUsername] = useState<string>('operator');
  const [authPassword, setAuthPassword] = useState<string>('OperatorPass123');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState<boolean>(false);
  const [pendingAction, setPendingAction] = useState<(() => Promise<void>) | null>(null);

  // Leaflet map refs
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const routePolylineGroupRef = useRef<L.LayerGroup | null>(null);
  const blockedEdgesGroupRef = useRef<L.LayerGroup | null>(null);
  const nodesGroupRef = useRef<L.LayerGroup | null>(null);
  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Sync current user from storage
  useEffect(() => {
    setCurrentUser(getStoredUser());
  }, []);

  // Filter edge manager if initialEdgeId is provided from an incident link
  useEffect(() => {
    if (initialEdgeId) {
      setEdgeFilter(initialEdgeId);
    }
  }, [initialEdgeId]);

  // Initial topology load
  useEffect(() => {
    let isMounted = true;
    async function loadTopology() {
      try {
        const [n, e] = await Promise.all([fetchRoutingNodes(), fetchRoutingEdges()]);
        if (isMounted) {
          setNodes(n);
          setEdges(e);
          if (n.length >= 2) {
            setOriginId(n[0].id);
            setDestinationId(n[3]?.id || n[1].id);
          }
        }
      } catch (err) {
        console.error('Failed to load routing topology:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    loadTopology();
    return () => {
      isMounted = false;
    };
  }, []);

  // Compute route when origin or destination changes
  const handleCalculateRoute = useCallback(async () => {
    if (!originId || !destinationId) return;
    setCalculating(true);
    try {
      const res = await calculateEmergencyRoute(originId, destinationId, 2);
      setRouteResult(res);
      setSelectedRouteIndex(0);
    } catch (err: any) {
      alert(`Routing calculation failed: ${err.message}`);
    } finally {
      setCalculating(false);
    }
  }, [originId, destinationId]);

  // Initial route calculation after topology loaded
  useEffect(() => {
    if (nodes.length >= 2 && !routeResult && !loading) {
      handleCalculateRoute();
    }
  }, [nodes, routeResult, loading, handleCalculateRoute]);

  // Auth helper
  const requireOperatorAuth = (action: () => Promise<void>) => {
    if (!getStoredToken() || !currentUser) {
      setPendingAction(() => action);
      setShowAuthModal(true);
      return;
    }
    action();
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthSubmitting(true);
    setAuthError(null);
    try {
      const res = await login(authUsername.trim(), authPassword);
      setStoredToken(res.access_token, res.user);
      setCurrentUser(res.user);
      setShowAuthModal(false);
      if (pendingAction) {
        const action = pendingAction;
        setPendingAction(null);
        await action();
      }
    } catch (err: any) {
      setAuthError(err.message || 'Login failed. Please verify credentials.');
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleSignOut = () => {
    clearStoredToken();
    setCurrentUser(null);
  };

  // Block edge execution
  const executeBlockEdge = async () => {
    if (!blockingEdgeId || !blockReason.trim()) return;
    try {
      await blockRoutingEdge(blockingEdgeId, blockReason.trim(), 'OPERATOR');
      setBlockingEdgeId(null);
      setBlockReason('');
      const updatedEdges = await fetchRoutingEdges();
      setEdges(updatedEdges);
      await handleCalculateRoute();
    } catch (err: any) {
      alert(`Failed to block edge: ${err.message}`);
    }
  };

  const handleBlockEdgeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    requireOperatorAuth(executeBlockEdge);
  };

  // Reopen edge execution
  const handleReopenEdge = (edgeId: string) => {
    requireOperatorAuth(async () => {
      try {
        await reopenRoutingEdge(edgeId, 'Cleared by command center operator');
        const updatedEdges = await fetchRoutingEdges();
        setEdges(updatedEdges);
        await handleCalculateRoute();
      } catch (err: any) {
        alert(`Failed to reopen edge: ${err.message}`);
      }
    });
  };

  // View edge audit history
  const handleViewEdgeHistory = async (edgeId: string) => {
    setHistoryEdgeId(edgeId);
    setHistoryLoading(true);
    try {
      const records = await fetchEdgeHistory(edgeId);
      setHistoryRecords(records);
    } catch (err) {
      console.error('Failed to fetch edge history:', err);
      setHistoryRecords([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const activeRoute: CalculatedRoute | null =
    routeResult?.status === 'FOUND'
      ? selectedRouteIndex === 0
        ? routeResult.primary_route || null
        : routeResult.alternative_routes[selectedRouteIndex - 1] || null
      : null;

  const filteredEdges = edges.filter(
    (e) =>
      e.name.toLowerCase().includes(edgeFilter.toLowerCase()) ||
      e.source_name?.toLowerCase().includes(edgeFilter.toLowerCase()) ||
      e.target_name?.toLowerCase().includes(edgeFilter.toLowerCase()) ||
      e.id.toLowerCase().includes(edgeFilter.toLowerCase())
  );

  // -------------------------------------------------------------
  // Safe Leaflet Map Lifecycle & Sizing
  // -------------------------------------------------------------
  useEffect(() => {
    if (viewMode !== 'tiles' || !mapContainerRef.current) {
      return;
    }

    let isDisposed = false;
    let initialTimerId: ReturnType<typeof setTimeout> | null = null;
    let rafId: number | null = null;
    let resizeObserver: ResizeObserver | null = null;

    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    const map = L.map(mapContainerRef.current, {
      center: FICTIONAL_VENUE.center,
      zoom: FICTIONAL_VENUE.defaultZoom,
      zoomControl: true,
      attributionControl: true,
    });

    mapInstanceRef.current = map;

    // Tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> | Darshini Emergency Corridor Layer',
    }).addTo(map);

    // Subtle venue zone polygons
    FICTIONAL_VENUE.zones.forEach((zone) => {
      L.polygon(zone.coordinates, {
        color: '#64748B',
        weight: 1,
        dashArray: '4, 4',
        fillColor: '#94A3B8',
        fillOpacity: 0.06,
      }).addTo(map);
    });

    // Create Layer Groups
    const polyGroup = L.layerGroup().addTo(map);
    const blockedGroup = L.layerGroup().addTo(map);
    const nodeGroup = L.layerGroup().addTo(map);

    routePolylineGroupRef.current = polyGroup;
    blockedEdgesGroupRef.current = blockedGroup;
    nodesGroupRef.current = nodeGroup;

    // Safe Invalidation with DOM Connectivity and Pane Verification
    const safeInvalidateSize = () => {
      if (isDisposed || !isMountedRef.current) return;
      if (!mapContainerRef.current || !mapContainerRef.current.isConnected) return;
      if (!mapInstanceRef.current || mapInstanceRef.current !== map) return;
      const container = map.getContainer();
      if (!container || !container.isConnected) return;
      const panes = map.getPanes();
      if (!panes || !panes.mapPane) return;

      try {
        map.invalidateSize();
      } catch (err) {
        console.debug('Handled unmounted invalidateSize guard:', err);
      }
    };

    const scheduleInvalidate = () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        safeInvalidateSize();
      });
    };

    if (typeof ResizeObserver !== 'undefined' && mapContainerRef.current) {
      resizeObserver = new ResizeObserver(() => {
        scheduleInvalidate();
      });
      resizeObserver.observe(mapContainerRef.current);
    }

    initialTimerId = setTimeout(() => {
      initialTimerId = null;
      safeInvalidateSize();
    }, 150);

    return () => {
      isDisposed = true;
      if (initialTimerId !== null) {
        clearTimeout(initialTimerId);
        initialTimerId = null;
      }
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
      routePolylineGroupRef.current = null;
      blockedEdgesGroupRef.current = null;
      nodesGroupRef.current = null;

      map.remove();
      mapInstanceRef.current = null;
    };
  }, [viewMode]);

  // Update Leaflet Route & Nodes Layers when state changes
  useEffect(() => {
    if (viewMode !== 'tiles' || !mapInstanceRef.current) return;

    const map = mapInstanceRef.current;
    const polyGroup = routePolylineGroupRef.current;
    const blockedGroup = blockedEdgesGroupRef.current;
    const nodeGroup = nodesGroupRef.current;

    if (!polyGroup || !blockedGroup || !nodeGroup) return;

    polyGroup.clearLayers();
    blockedGroup.clearLayers();
    nodeGroup.clearLayers();

    // 1. Draw Blocked Edges with dashed red line & warning badge
    edges.forEach((edge) => {
      if (edge.is_blocked && edge.coordinates && edge.coordinates.length >= 2) {
        const poly = L.polyline(edge.coordinates, {
          color: '#B42318',
          weight: 5,
          dashArray: '6, 6',
          opacity: 0.9,
        }).addTo(blockedGroup);
        poly.bindTooltip(
          `<strong>BLOCKED CORRIDOR</strong><br/>${edge.name}<br/>Reason: ${edge.block_reason || 'Incident closure'}`
        );
      }
    });

    // 2. Draw Active Calculated Route with glowing high-contrast line
    if (activeRoute && activeRoute.segments.length > 0) {
      const latlngs: [number, number][] = [];
      activeRoute.segments.forEach((seg) => {
        if (seg.coordinates && seg.coordinates.length >= 2) {
          latlngs.push(seg.coordinates[0] as [number, number]);
          latlngs.push(seg.coordinates[1] as [number, number]);
        }
      });

      if (latlngs.length >= 2) {
        const isOptimal = activeRoute.status === 'OPTIMAL';
        // Outer glow
        L.polyline(latlngs, {
          color: isOptimal ? '#237A57' : '#D97706',
          weight: 9,
          opacity: 0.35,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(polyGroup);

        // Inner solid line
        const routePoly = L.polyline(latlngs, {
          color: isOptimal ? '#237A57' : '#B45309',
          weight: 5,
          opacity: 0.95,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(polyGroup);

        routePoly.bindTooltip(
          `<strong>${activeRoute.route_name}</strong><br/>Distance: ${activeRoute.total_distance_meters}m • Walk: ~${activeRoute.estimated_travel_time_minutes} min`
        );

        if (map.getContainer()?.isConnected) {
          try {
            map.fitBounds(routePoly.getBounds(), { padding: [45, 45], maxZoom: 17 });
          } catch {}
        }
      }
    }

    // 3. Draw Nodes (Pins for Origin & Destination, circles for others)
    nodes.forEach((n) => {
      const isOrigin = n.id === originId;
      const isDest = n.id === destinationId;
      const isPath = activeRoute?.node_path.includes(n.id);

      if (isOrigin) {
        const icon = L.divIcon({
          className: 'custom-routing-pin',
          html: `<div class="routing-pin-origin">📍 ORIGIN: ${n.name}</div>`,
          iconSize: [120, 24],
          iconAnchor: [60, 24],
        });
        L.marker(n.coordinates, { icon, zIndexOffset: 1000 }).addTo(nodeGroup);
      } else if (isDest) {
        const icon = L.divIcon({
          className: 'custom-routing-pin',
          html: `<div class="routing-pin-destination">🏁 DEST: ${n.name}</div>`,
          iconSize: [120, 24],
          iconAnchor: [60, 24],
        });
        L.marker(n.coordinates, { icon, zIndexOffset: 1000 }).addTo(nodeGroup);
      } else {
        const circleMarker = L.circleMarker(n.coordinates, {
          radius: isPath ? 6 : 4,
          fillColor: isPath ? '#A6F4C5' : '#FFFFFF',
          color: isPath ? '#237A57' : '#64748B',
          weight: 2,
          fillOpacity: 0.9,
        }).addTo(nodeGroup);

        circleMarker.bindTooltip(`${n.name} (${n.type})<br/>Click to set as destination`);
        circleMarker.on('click', () => {
          setDestinationId(n.id);
        });
      }
    });
  }, [viewMode, edges, activeRoute, nodes, originId, destinationId]);

  return (
    <div className="routing-workspace">
      {/* Left Control Panel */}
      <div className="routing-panel">
        {/* Operator Session Banner */}
        <div
          className={`operator-auth-banner ${
            currentUser ? 'authenticated' : 'unauthenticated'
          }`}
        >
          {currentUser ? (
            <>
              <div>
                <strong>🛡️ Authorized Operator:</strong> {currentUser.full_name} ({currentUser.role})
              </div>
              <button
                type="button"
                className="events-subnav-btn"
                style={{ fontSize: '11px', padding: '2px 8px' }}
                onClick={handleSignOut}
              >
                Sign Out
              </button>
            </>
          ) : (
            <>
              <div>
                <strong>⚠️ Operator Sign-In Required</strong> to block or reopen corridors
              </div>
              <button
                type="button"
                className="events-subnav-btn"
                style={{
                  fontSize: '11px',
                  padding: '2px 8px',
                  background: 'var(--accent-primary)',
                  color: '#FFFFFF',
                  fontWeight: 600,
                }}
                onClick={() => setShowAuthModal(true)}
              >
                Sign In
              </button>
            </>
          )}
        </div>

        {/* Origin / Destination Selector */}
        <div className="routing-card">
          <div className="routing-card-header">
            <div>
              <h2
                style={{
                  fontSize: '16px',
                  fontWeight: 700,
                  margin: 0,
                  color: 'var(--text-primary)',
                }}
              >
                Emergency Clearance Route Solver
              </h2>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                Fastest Cleared Path • Obstacle Avoidance • Dynamic Bypass
              </div>
            </div>
            <span className="chip" style={{ background: 'var(--surface-secondary)' }}>
              SIMULATED TOPOLOGY
            </span>
          </div>

          <div className="form-group">
            <label className="form-label">Origin Location (Incident / Dispatch Point)</label>
            <select
              className="form-input"
              value={originId}
              onChange={(e) => setOriginId(e.target.value)}
              disabled={loading}
            >
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name} ({n.type})
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Destination (Assembly / Medical / Egress)</label>
            <select
              className="form-input"
              value={destinationId}
              onChange={(e) => setDestinationId(e.target.value)}
              disabled={loading}
            >
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name} ({n.type})
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            className="btn-primary"
            onClick={handleCalculateRoute}
            disabled={calculating || originId === destinationId}
          >
            {calculating ? 'Solving Cleared Corridor...' : 'Calculate Optimal Emergency Route'}
          </button>
        </div>

        {/* Calculation Outcome Display */}
        {routeResult && (
          <div className="routing-card">
            {routeResult.status === 'NO_PATH_AVAILABLE' ? (
              <div
                className="scanner-feedback-box scanner-feedback-error"
                style={{ flexDirection: 'column', alignItems: 'flex-start' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700 }}>
                  <span>❌ NO CLEARED CORRIDOR AVAILABLE</span>
                </div>
                <div style={{ fontSize: '12px', marginTop: '6px', fontWeight: 400 }}>
                  Active road blockages compromise all known paths between {routeResult.origin_name} and{' '}
                  {routeResult.destination_name}. Reopen one of the blocked corridors below or establish an external cordon.
                </div>
                {routeResult.blocked_edges_encountered.length > 0 && (
                  <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>
                    Compromised edges:{' '}
                    {routeResult.blocked_edges_encountered.map((eid) => {
                      const e = edges.find((item) => item.id === eid);
                      return e ? e.name : eid;
                    }).join(', ')}
                  </div>
                )}
              </div>
            ) : (
              <div>
                {/* Alternative Route Tabs */}
                {routeResult.alternative_routes.length > 0 && (
                  <div style={{ display: 'flex', gap: '6px', marginBottom: '14px' }}>
                    <button
                      type="button"
                      className={`events-subnav-btn ${selectedRouteIndex === 0 ? 'active' : ''}`}
                      style={{
                        fontSize: '12px',
                        padding: '4px 10px',
                        flex: 1,
                        border: '1px solid var(--border-default)',
                      }}
                      onClick={() => setSelectedRouteIndex(0)}
                    >
                      Primary Cleared ({routeResult.primary_route?.total_distance_meters}m)
                    </button>
                    {routeResult.alternative_routes.map((alt, idx) => (
                      <button
                        key={alt.route_index}
                        type="button"
                        className={`events-subnav-btn ${selectedRouteIndex === idx + 1 ? 'active' : ''}`}
                        style={{
                          fontSize: '12px',
                          padding: '4px 10px',
                          flex: 1,
                          border: '1px solid var(--border-default)',
                        }}
                        onClick={() => setSelectedRouteIndex(idx + 1)}
                      >
                        Bypass #{idx + 1} ({alt.total_distance_meters}m)
                      </button>
                    ))}
                  </div>
                )}

                {/* Metrics */}
                {activeRoute && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 700, fontSize: '15px' }}>{activeRoute.route_name}</span>
                      <span className="chip chip-published">{activeRoute.status}</span>
                    </div>

                    <div className="route-stat-grid">
                      <div className="route-stat-box">
                        <div className="route-stat-val">{activeRoute.total_distance_meters}m</div>
                        <div className="route-stat-lbl">Distance</div>
                      </div>
                      <div className="route-stat-box">
                        <div className="route-stat-val">~{activeRoute.estimated_travel_time_minutes} min</div>
                        <div className="route-stat-lbl">Walk Duration</div>
                      </div>
                      <div className="route-stat-box">
                        <div className="route-stat-val">{activeRoute.segments.length}</div>
                        <div className="route-stat-lbl">Corridors</div>
                      </div>
                    </div>

                    <div
                      style={{
                        fontSize: '11px',
                        color: 'var(--text-muted)',
                        marginTop: '6px',
                        textAlign: 'center',
                      }}
                    >
                      Speed assumption: 1.2 m/s average brisk pedestrian/evacuation pace
                    </div>

                    {/* Turn-by-turn clearance corridors */}
                    <div className="route-segments-list">
                      {activeRoute.segments.map((seg, idx) => (
                        <div key={seg.edge_id} className="route-segment-item">
                          <span style={{ fontWeight: 700, color: 'var(--accent-primary)', minWidth: '18px' }}>
                            {idx + 1}.
                          </span>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600 }}>{seg.edge_name}</div>
                            <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                              {seg.source_name} ➔ {seg.target_name} ({seg.length_meters}m)
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Blocked Edges Manager */}
        <div className="routing-card">
          <div className="routing-card-header">
            <h2 style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>
              Corridor Blockage Manager ({edges.filter((e) => e.is_blocked).length} Blocked)
            </h2>
            <input
              type="text"
              className="form-input"
              style={{ width: '150px', padding: '4px 8px', fontSize: '12px' }}
              placeholder="Search corridors..."
              value={edgeFilter}
              onChange={(e) => setEdgeFilter(e.target.value)}
            />
          </div>

          <div style={{ maxHeight: '240px', overflowY: 'auto' }}>
            {filteredEdges.map((edge) => (
              <div key={edge.id} className="blocked-edge-row">
                <div style={{ flex: 1, paddingRight: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontWeight: 600, fontSize: '13px' }}>{edge.name}</span>
                    {edge.is_blocked ? (
                      <span className="edge-blocked-badge">BLOCKED</span>
                    ) : (
                      <span className="edge-cleared-badge">CLEARED</span>
                    )}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                    {edge.source_name} ➔ {edge.target_name} • {edge.length_meters}m
                  </div>
                  {edge.is_blocked && edge.block_reason && (
                    <div style={{ fontSize: '11px', color: 'var(--status-critical)', marginTop: '2px' }}>
                      Reason: {edge.block_reason} ({edge.blocked_by_name || 'Staff'})
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <button
                    type="button"
                    className="events-subnav-btn"
                    style={{ padding: '3px 6px', fontSize: '11px' }}
                    title="View historical audit logs for this edge"
                    onClick={() => handleViewEdgeHistory(edge.id)}
                  >
                    History
                  </button>

                  {edge.is_blocked ? (
                    <button
                      type="button"
                      className="events-subnav-btn"
                      style={{
                        padding: '3px 8px',
                        fontSize: '11px',
                        background: 'var(--status-positive-bg)',
                        color: 'var(--status-positive)',
                        fontWeight: 600,
                      }}
                      onClick={() => handleReopenEdge(edge.id)}
                    >
                      Reopen
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="events-subnav-btn"
                      style={{
                        padding: '3px 8px',
                        fontSize: '11px',
                        border: '1px solid var(--border-default)',
                        color: 'var(--status-critical)',
                        fontWeight: 600,
                      }}
                      onClick={() => setBlockingEdgeId(edge.id)}
                    >
                      Block Road
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right Map / Schematic Visualization Area */}
      <div className="routing-map-container">
        <div className="routing-map-header">
          <div>
            <strong>Interactive Clearance Corridor Map</strong>
            <span style={{ color: 'var(--text-muted)', marginLeft: '8px' }}>
              • Green: Cleared Active Path • Red: Compromised / Blocked Edge
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div className="map-view-switcher">
              <button
                type="button"
                className={`map-view-btn ${viewMode === 'tiles' ? 'active' : ''}`}
                onClick={() => setViewMode('tiles')}
              >
                🗺️ GIS Map
              </button>
              <button
                type="button"
                className={`map-view-btn ${viewMode === 'schematic' ? 'active' : ''}`}
                onClick={() => setViewMode('schematic')}
              >
                📐 Schematic Grid
              </button>
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)' }}>
              PRECINCT-GRID: 880x520
            </span>
          </div>
        </div>

        <div className="routing-map-canvas">
          {/* GIS Leaflet Map Mode */}
          {viewMode === 'tiles' && (
            <div ref={mapContainerRef} className="routing-leaflet-container" />
          )}

          {/* Vector Schematic SVG Mode */}
          {viewMode === 'schematic' && (
            <svg
              viewBox="0 0 880 520"
              style={{ width: '100%', height: '100%', background: '#F8FAFC', position: 'absolute', top: 0, left: 0 }}
            >
              <defs>
                <pattern id="routing-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#E2E8F0" strokeWidth="0.8" />
                </pattern>
              </defs>
              <rect width="880" height="520" fill="url(#routing-grid)" />

              {/* Base Edges */}
              {edges.map((e) => {
                const srcNode = nodes.find((n) => n.id === e.source);
                const tgtNode = nodes.find((n) => n.id === e.target);
                if (!srcNode || !tgtNode) return null;

                const isPathEdge = activeRoute?.edge_path.includes(e.id);
                const strokeColor = e.is_blocked
                  ? '#B42318'
                  : isPathEdge
                  ? '#237A57'
                  : '#94A3B8';
                const strokeWidth = isPathEdge ? 5 : e.is_blocked ? 3 : 2;
                const strokeDash = e.is_blocked ? '6,4' : 'none';

                return (
                  <g key={e.id}>
                    <line
                      x1={srcNode.svg_pos[0]}
                      y1={srcNode.svg_pos[1]}
                      x2={tgtNode.svg_pos[0]}
                      y2={tgtNode.svg_pos[1]}
                      stroke={strokeColor}
                      strokeWidth={strokeWidth}
                      strokeDasharray={strokeDash}
                      strokeLinecap="round"
                    />
                    {e.is_blocked && (
                      <circle
                        cx={(srcNode.svg_pos[0] + tgtNode.svg_pos[0]) / 2}
                        cy={(srcNode.svg_pos[1] + tgtNode.svg_pos[1]) / 2}
                        r={7}
                        fill="#B42318"
                      />
                    )}
                  </g>
                );
              })}

              {/* Graph Nodes */}
              {nodes.map((n) => {
                const isOrigin = n.id === originId;
                const isDest = n.id === destinationId;
                const isPathNode = activeRoute?.node_path.includes(n.id);

                let nodeFill = '#FFFFFF';
                let nodeStroke = '#64748B';
                let radius = 7;

                if (isOrigin) {
                  nodeFill = '#245D9C';
                  nodeStroke = '#172B43';
                  radius = 11;
                } else if (isDest) {
                  nodeFill = '#237A57';
                  nodeStroke = '#0F5132';
                  radius = 11;
                } else if (isPathNode) {
                  nodeFill = '#A6F4C5';
                  nodeStroke = '#237A57';
                  radius = 8;
                }

                return (
                  <g
                    key={n.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setDestinationId(n.id)}
                  >
                    <circle
                      cx={n.svg_pos[0]}
                      cy={n.svg_pos[1]}
                      r={radius}
                      fill={nodeFill}
                      stroke={nodeStroke}
                      strokeWidth={2.5}
                    />
                    <text
                      x={n.svg_pos[0]}
                      y={n.svg_pos[1] - (radius + 4)}
                      fontSize={10}
                      fontWeight={isOrigin || isDest ? 700 : 500}
                      fill={isOrigin || isDest ? '#0F172A' : '#475467'}
                      textAnchor="middle"
                    >
                      {n.name}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}
        </div>
      </div>

      {/* Block Corridor Modal */}
      {blockingEdgeId && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2 style={{ fontSize: '16px', fontWeight: 700, margin: 0, color: 'var(--status-critical)' }}>
                Block Corridor for Emergency Clearance
              </h2>
              <button
                type="button"
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }}
                onClick={() => setBlockingEdgeId(null)}
              >
                &times;
              </button>
            </div>
            <form onSubmit={handleBlockEdgeSubmit}>
              <div className="modal-body">
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '14px' }}>
                  Blocking this corridor will immediately exclude it from the Dijkstra emergency solver and force route recalculation.
                </p>
                <div className="form-group">
                  <label className="form-label">Operational Reason for Blockage *</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Crowd overflow surge past turnstiles / Fallen scaffold"
                    value={blockReason}
                    onChange={(e) => setBlockReason(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="events-subnav-btn" onClick={() => setBlockingEdgeId(null)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  style={{ width: 'auto', background: 'var(--status-critical)' }}
                >
                  Confirm Blockage
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Audit History Modal */}
      {historyEdgeId && (
        <div className="modal-overlay" onClick={() => setHistoryEdgeId(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '520px' }}>
            <div className="modal-header">
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>Corridor Audit History</h3>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Corridor ID: <code>{historyEdgeId}</code>
                </div>
              </div>
              <button
                type="button"
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }}
                onClick={() => setHistoryEdgeId(null)}
              >
                &times;
              </button>
            </div>

            <div className="modal-body">
              {historyLoading ? (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  Loading chronological audit events...
                </div>
              ) : historyRecords.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  No historical block or reopen operations recorded for this corridor.
                </div>
              ) : (
                <div className="audit-history-list">
                  {historyRecords.map((rec) => (
                    <div
                      key={rec.id}
                      className={`audit-history-item ${rec.action === 'BLOCK' ? 'block' : 'reopen'}`}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                        <span style={{ color: rec.action === 'BLOCK' ? 'var(--status-critical)' : 'var(--status-positive)' }}>
                          {rec.action === 'BLOCK' ? '🚫 BLOCKED' : '✅ REOPENED'}
                        </span>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          {new Date(rec.timestamp).toLocaleString()}
                        </span>
                      </div>
                      <div style={{ marginTop: '4px', color: 'var(--text-primary)' }}>"{rec.reason}"</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                        Authorized by: <strong>{rec.operator_username || 'Operator'}</strong> • Source: {rec.source}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button type="button" className="events-subnav-btn" onClick={() => setHistoryEdgeId(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Operator Authentication Modal */}
      {showAuthModal && (
        <div className="modal-overlay" onClick={() => setShowAuthModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '440px' }}>
            <div className="modal-header">
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>Operator Sign-In</h3>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Authorizes road blockages and safety operations
                </div>
              </div>
              <button
                type="button"
                style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }}
                onClick={() => setShowAuthModal(false)}
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleLoginSubmit}>
              <div className="modal-body">
                {authError && (
                  <div style={{ color: 'var(--status-critical)', fontSize: '12px', marginBottom: '10px' }}>
                    {authError}
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label">Operator Username</label>
                  <input
                    type="text"
                    className="form-input"
                    value={authUsername}
                    onChange={(e) => setAuthUsername(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Password</label>
                  <input
                    type="password"
                    className="form-input"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    required
                  />
                </div>

                <div style={{ background: 'var(--surface-secondary)', padding: '8px 12px', borderRadius: '4px', fontSize: '11px', color: 'var(--text-muted)' }}>
                  💡 <strong>Demo Credentials:</strong> Username: <code>operator</code> • Password: <code>OperatorPass123</code>
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="events-subnav-btn" onClick={() => setShowAuthModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={authSubmitting} style={{ width: 'auto' }}>
                  {authSubmitting ? 'Authenticating...' : 'Sign In as Operator'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
