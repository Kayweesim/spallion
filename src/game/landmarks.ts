export type LandmarkKind =
  | 'pad' | 'clouds' | 'stratosphere' | 'orbit' | 'moon' | 'mars' | 'belt'
  | 'jupiter' | 'saturn' | 'neptune' | 'nebula' | 'blackhole' | 'core';

export interface Landmark {
  kind: LandmarkKind;
  name: string;
  points: number; // score (altitude) at which you fly past it
}

/** World units climbed per point scored. */
export const UNIT = 12;

// Early landmarks are close together so even a modest run feels like progress.
export const LANDMARKS: Landmark[] = [
  { kind: 'pad', name: 'Launch Pad', points: 0 },
  { kind: 'clouds', name: 'Cloud Layer', points: 15 },
  { kind: 'stratosphere', name: 'Stratosphere', points: 45 },
  { kind: 'orbit', name: 'Low Orbit', points: 80 },
  { kind: 'moon', name: 'The Moon', points: 130 },
  { kind: 'mars', name: 'Mars', points: 200 },
  { kind: 'belt', name: 'Asteroid Belt', points: 270 },
  { kind: 'jupiter', name: 'Jupiter', points: 350 },
  { kind: 'saturn', name: 'Saturn', points: 430 },
  { kind: 'neptune', name: 'Neptune', points: 510 },
  { kind: 'nebula', name: 'Neon Nebula', points: 580 },
  { kind: 'blackhole', name: 'Event Horizon', points: 640 },
  { kind: 'core', name: 'Galactic Core', points: 700 },
];

export function landmarkAt(points: number): Landmark {
  let current = LANDMARKS[0];
  for (const l of LANDMARKS) if (points >= l.points) current = l;
  return current;
}

export function nextLandmark(points: number): Landmark | null {
  return LANDMARKS.find((l) => l.points > points) ?? null;
}
