import type { VenueConfiguration } from '../types/venue';

/**
 * Fictional Venue Configuration for Darshini Demo
 * All zones, counts, gates, and road connections are simulated/deterministic demo data.
 * No real-world crowd counts or live surveillance feeds are claimed or represented.
 */
export const FICTIONAL_VENUE: VenueConfiguration = {
  id: 'venue-darshini-park',
  name: 'Darshini Exhibition & Arena Precinct',
  precinctType: 'Municipal Sports & Expo Complex (Fictional Configuration)',
  center: [28.6145, 77.2100],
  defaultZoom: 16,
  disclaimer: 'SIMULATED DATA: All zones, capacities, and pedestrian tallies represent configured demonstration fixtures.',
  zones: [
    {
      id: 'zone-north-plaza',
      code: 'Z-01',
      name: 'North Gate Plaza',
      description: 'Primary public arrival plaza adjacent to Gate A turnstiles. Currently modeling high inflow queue buildup.',
      areaSqm: 1200,
      safeCapacity: 2400,
      simulatedCount: 3120,
      densityPerSqm: 2.6,
      fruinLoS: 'F',
      status: 'CRITICAL',
      coordinates: [
        [28.6170, 77.2085],
        [28.6170, 77.2115],
        [28.6155, 77.2115],
        [28.6155, 77.2085]
      ],
      svgRect: {
        x: 250,
        y: 40,
        width: 380,
        height: 100,
        labelX: 440,
        labelY: 95
      }
    },
    {
      id: 'zone-central-concourse',
      code: 'Z-02',
      name: 'Central Promenade',
      description: 'Central spine connecting North and South exposition pavilions with outdoor food stalls.',
      areaSqm: 2500,
      safeCapacity: 3750,
      simulatedCount: 2850,
      densityPerSqm: 1.14,
      fruinLoS: 'E',
      status: 'WARNING',
      coordinates: [
        [28.6153, 77.2090],
        [28.6153, 77.2110],
        [28.6135, 77.2110],
        [28.6135, 77.2090]
      ],
      svgRect: {
        x: 320,
        y: 170,
        width: 240,
        height: 150,
        labelX: 440,
        labelY: 250
      }
    },
    {
      id: 'zone-pavilion-east',
      code: 'Z-03',
      name: 'Pavilion Hall A (East)',
      description: 'Main indoor arena and conference pavilion with multi-door fire egress routes.',
      areaSqm: 3200,
      safeCapacity: 4800,
      simulatedCount: 2400,
      densityPerSqm: 0.75,
      fruinLoS: 'D',
      status: 'NORMAL',
      coordinates: [
        [28.6153, 77.2115],
        [28.6153, 77.2135],
        [28.6135, 77.2135],
        [28.6135, 77.2115]
      ],
      svgRect: {
        x: 600,
        y: 170,
        width: 230,
        height: 150,
        labelX: 715,
        labelY: 250
      }
    },
    {
      id: 'zone-west-corridor',
      code: 'Z-04',
      name: 'West Emergency Corridor',
      description: 'Cleared transit lane reserved for first-response medical vehicles and logistics staff.',
      areaSqm: 900,
      safeCapacity: 1350,
      simulatedCount: 270,
      densityPerSqm: 0.3,
      fruinLoS: 'B',
      status: 'NORMAL',
      coordinates: [
        [28.6153, 77.2065],
        [28.6153, 77.2085],
        [28.6135, 77.2085],
        [28.6135, 77.2065]
      ],
      svgRect: {
        x: 50,
        y: 170,
        width: 230,
        height: 150,
        labelX: 165,
        labelY: 250
      }
    },
    {
      id: 'zone-south-terminal',
      code: 'Z-05',
      name: 'South Metro Hub',
      description: 'Intermodal transit plaza linking ground shuttle buses with underground metro lines.',
      areaSqm: 1800,
      safeCapacity: 2700,
      simulatedCount: 3240,
      densityPerSqm: 1.8,
      fruinLoS: 'E',
      status: 'WARNING',
      coordinates: [
        [28.6132, 77.2085],
        [28.6132, 77.2115],
        [28.6118, 77.2115],
        [28.6118, 77.2085]
      ],
      svgRect: {
        x: 250,
        y: 350,
        width: 380,
        height: 110,
        labelX: 440,
        labelY: 410
      }
    }
  ],
  gates: [
    {
      id: 'gate-a-north',
      code: 'GATE-A',
      name: 'North Entry Gate A',
      status: 'OPEN',
      capacityPerHour: 4800,
      coordinates: [28.6171, 77.2100],
      svgPoint: { x: 440, y: 35 }
    },
    {
      id: 'gate-b-east',
      code: 'GATE-B',
      name: 'East Pavilion Access',
      status: 'RESTRICTED',
      capacityPerHour: 2200,
      coordinates: [28.6144, 77.2136],
      svgPoint: { x: 835, y: 245 }
    },
    {
      id: 'gate-c-south',
      code: 'GATE-C',
      name: 'South Metro Gate',
      status: 'OPEN',
      capacityPerHour: 5500,
      coordinates: [28.6117, 77.2100],
      svgPoint: { x: 440, y: 465 }
    },
    {
      id: 'gate-d-west',
      code: 'GATE-D',
      name: 'West Emergency Gate',
      status: 'OPEN',
      capacityPerHour: 1500,
      coordinates: [28.6144, 77.2064],
      svgPoint: { x: 45, y: 245 }
    }
  ],
  roads: [
    {
      id: 'road-north-ring',
      name: 'North Perimeter Boulevard',
      type: 'PERIMETER_BYPASS',
      status: 'CLEAR',
      lengthMeters: 620,
      polyline: [
        [28.6175, 77.2060],
        [28.6175, 77.2140]
      ],
      svgCoords: { x1: 40, y1: 20, x2: 840, y2: 20 }
    },
    {
      id: 'road-east-arterial',
      name: 'East Exhibition Link',
      type: 'PRIMARY_ARTERIAL',
      status: 'CONGESTED',
      lengthMeters: 550,
      polyline: [
        [28.6175, 77.2140],
        [28.6115, 77.2140]
      ],
      svgCoords: { x1: 840, y1: 20, x2: 840, y2: 480 }
    },
    {
      id: 'road-south-ring',
      name: 'South Terminal Way',
      type: 'PERIMETER_BYPASS',
      status: 'CLEAR',
      lengthMeters: 620,
      polyline: [
        [28.6115, 77.2140],
        [28.6115, 77.2060]
      ],
      svgCoords: { x1: 840, y1: 480, x2: 40, y2: 480 }
    },
    {
      id: 'road-west-emergency',
      name: 'West Service & Egress Lane',
      type: 'EMERGENCY_CORRIDOR',
      status: 'CLEAR',
      lengthMeters: 550,
      polyline: [
        [28.6115, 77.2060],
        [28.6175, 77.2060]
      ],
      svgCoords: { x1: 40, y1: 480, x2: 40, y2: 20 }
    }
  ],
  cameras: [
    {
      id: 'cam-01',
      code: 'CAM-01',
      name: 'North Gate Plaza Inflow Station',
      assignedZoneId: 'zone-north-plaza',
      coordinates: [28.6163, 77.2100],
      svgPoint: { x: 440, y: 75 },
      isConfiguredVenuePoint: true
    },
    {
      id: 'cam-02',
      code: 'CAM-02',
      name: 'Central Promenade Spine Station',
      assignedZoneId: 'zone-central-concourse',
      coordinates: [28.6144, 77.2100],
      svgPoint: { x: 440, y: 235 },
      isConfiguredVenuePoint: true
    },
    {
      id: 'cam-03',
      code: 'CAM-03',
      name: 'Pavilion Hall A (East) Arena Station',
      assignedZoneId: 'zone-pavilion-east',
      coordinates: [28.6144, 77.2125],
      svgPoint: { x: 715, y: 235 },
      isConfiguredVenuePoint: true
    },
    {
      id: 'cam-04',
      code: 'CAM-04',
      name: 'West Emergency Corridor Station',
      assignedZoneId: 'zone-west-corridor',
      coordinates: [28.6144, 77.2075],
      svgPoint: { x: 165, y: 235 },
      isConfiguredVenuePoint: true
    },
    {
      id: 'cam-05',
      code: 'CAM-05',
      name: 'South Metro Hub Transit Station',
      assignedZoneId: 'zone-south-terminal',
      coordinates: [28.6125, 77.2100],
      svgPoint: { x: 440, y: 395 },
      isConfiguredVenuePoint: true
    }
  ]
};
