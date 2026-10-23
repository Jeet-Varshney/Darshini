export type FruinLoS = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
export type ZoneStatus = 'NORMAL' | 'WARNING' | 'CRITICAL';

export interface VenueZone {
  id: string;
  code: string;
  name: string;
  description: string;
  areaSqm: number;
  safeCapacity: number;
  simulatedCount: number;
  densityPerSqm: number;
  fruinLoS: FruinLoS;
  status: ZoneStatus;
  coordinates: [number, number][]; // LatLng polygon points for Leaflet
  svgRect: {
    x: number;
    y: number;
    width: number;
    height: number;
    labelX: number;
    labelY: number;
  };
}

export interface VenueGate {
  id: string;
  code: string;
  name: string;
  status: 'OPEN' | 'RESTRICTED' | 'CLOSED';
  capacityPerHour: number;
  coordinates: [number, number]; // LatLng point
  svgPoint: {
    x: number;
    y: number;
  };
}

export interface VenueRoad {
  id: string;
  name: string;
  type: 'PRIMARY_ARTERIAL' | 'PERIMETER_BYPASS' | 'PEDESTRIAN_CONCOURSE' | 'EMERGENCY_CORRIDOR';
  status: 'CLEAR' | 'CONGESTED' | 'BLOCKED';
  lengthMeters: number;
  polyline: [number, number][];
  svgCoords: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  };
}

export interface VenueConfiguration {
  id: string;
  name: string;
  precinctType: string;
  center: [number, number]; // [lat, lng]
  defaultZoom: number;
  zones: VenueZone[];
  gates: VenueGate[];
  roads: VenueRoad[];
  disclaimer: string;
}
