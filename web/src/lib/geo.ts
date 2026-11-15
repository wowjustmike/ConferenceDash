export const CITY_COORDS: Record<string, [number, number]> = {
  'Las Vegas, Nevada': [36.17, -115.14],
  'Los Angeles, California': [34.05, -118.24],
  'Anaheim, California': [33.84, -117.91],
  'Austin, Texas': [30.27, -97.74],
  'Houston, Texas': [29.76, -95.37],
  'Orlando, Florida': [28.54, -81.38],
  'Chicago, Illinois': [41.88, -87.63],
}

export function coordsFor(city: string, state: string): [number, number] | null {
  return CITY_COORDS[`${city}, ${state}`] ?? null
}
