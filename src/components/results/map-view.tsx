"use client";

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix Leaflet default icon issue in Next.js
const homeIcon = new L.Icon({
  iconUrl:
    "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const officeIcon = new L.Icon({
  iconUrl:
    "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

interface MapViewProps {
  homeAddress?: string;
  officeAddress?: string;
}

export default function MapView({ homeAddress, officeAddress }: MapViewProps) {
  const [homeCoords, setHomeCoords] = useState<[number, number] | null>(null);
  const [officeCoords, setOfficeCoords] = useState<[number, number] | null>(
    null
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function geocode(address: string): Promise<[number, number] | null> {
      try {
        const res = await fetch(
          `/api/geocode?address=${encodeURIComponent(address)}`
        );
        const data = await res.json();
        if (data.lat !== null && data.lng !== null) {
          return [data.lat, data.lng];
        }
      } catch {
        // Geocoding failed
      }
      return null;
    }

    async function loadCoords() {
      const promises = [];

      if (homeAddress) {
        promises.push(
          geocode(homeAddress).then((coords) => setHomeCoords(coords))
        );
      }
      if (officeAddress) {
        promises.push(
          geocode(officeAddress).then((coords) => setOfficeCoords(coords))
        );
      }

      await Promise.all(promises);
      setLoading(false);
    }

    loadCoords();
  }, [homeAddress, officeAddress]);

  if (loading) {
    return <div className="h-64 glass-card rounded-2xl animate-pulse" />;
  }

  if (!homeCoords && !officeCoords) {
    return (
      <div className="h-64 glass-card rounded-2xl flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Could not geocode addresses</p>
      </div>
    );
  }

  const center = homeCoords || officeCoords || [39.8283, -98.5795];
  const bounds: [number, number][] = [];
  if (homeCoords) bounds.push(homeCoords);
  if (officeCoords) bounds.push(officeCoords);

  return (
    <div className="h-64 rounded-2xl overflow-hidden">
      <MapContainer
        center={center}
        zoom={bounds.length > 1 ? 5 : 12}
        className="h-full w-full"
        scrollWheelZoom={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        />
        {homeCoords && (
          <Marker position={homeCoords} icon={homeIcon}>
            <Popup>
              <strong>Home</strong>
              <br />
              {homeAddress}
            </Popup>
          </Marker>
        )}
        {officeCoords && (
          <Marker position={officeCoords} icon={officeIcon}>
            <Popup>
              <strong>Office</strong>
              <br />
              {officeAddress}
            </Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  );
}
