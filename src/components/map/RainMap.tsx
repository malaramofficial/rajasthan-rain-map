import "leaflet/dist/leaflet.css";

import { CircleMarker, MapContainer, TileLayer, Tooltip } from "react-leaflet";

import type { PublicRainSnapshot, RainStatus } from "@/lib/rain/types";

/** Rajasthan bounding box, used to frame and constrain the map. */
const RAJASTHAN_BOUNDS: [[number, number], [number, number]] = [
  [23.0, 69.3],
  [30.3, 78.4],
];

const STATUS_CLASS: Record<RainStatus, string> = {
  raining: "rain-marker rain-marker--raining",
  recent_rain: "rain-marker rain-marker--recent",
  forecast: "rain-marker rain-marker--forecast",
  dry: "rain-marker rain-marker--dry",
};

export default function RainMap({ snapshot }: { snapshot: PublicRainSnapshot }) {
  return (
    <MapContainer
      bounds={RAJASTHAN_BOUNDS}
      boundsOptions={{ padding: [8, 8] }}
      maxBounds={RAJASTHAN_BOUNDS}
      maxBoundsViscosity={0.9}
      zoomSnap={0.1}
      zoomDelta={0.5}
      minZoom={5}
      maxZoom={11}
      zoomControl={false}
      attributionControl={false}
      className="h-full w-full bg-background"
    >
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        className="rain-basemap"
      />

      {snapshot.points.map((point) => (
        <CircleMarker
          key={point.id}
          center={[point.latitude, point.longitude]}
          radius={9}
          className={STATUS_CLASS[point.status]}
          pathOptions={{ weight: 2 }}
        >
          <Tooltip direction="top" offset={[0, -8]} opacity={1} className="rain-tooltip">
            <span className="font-medium">{point.place}</span>
          </Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
