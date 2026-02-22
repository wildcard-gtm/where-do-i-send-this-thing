import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export async function GET(request: Request) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");
  if (!address) {
    return NextResponse.json({ error: "address param required" }, { status: 400 });
  }

  try {
    // Nominatim (OpenStreetMap) — free, no API key, natural pair for Leaflet
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`,
      {
        headers: { "User-Agent": "wdistt-app/1.0" }, // Nominatim requires a User-Agent
        next: { revalidate: 86400 }, // cache 24h — addresses don't change
      }
    );
    const data = await res.json();

    if (!data?.length) {
      return NextResponse.json({ lat: null, lng: null });
    }

    return NextResponse.json({ lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) });
  } catch {
    return NextResponse.json({ lat: null, lng: null });
  }
}
