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

  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Geocoding not configured" }, { status: 503 });
  }

  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`,
      { next: { revalidate: 86400 } } // cache 24h — addresses don't change
    );
    const data = await res.json();

    if (data.status !== "OK" || !data.results?.length) {
      return NextResponse.json({ lat: null, lng: null });
    }

    const { lat, lng } = data.results[0].geometry.location;
    return NextResponse.json({ lat, lng });
  } catch {
    return NextResponse.json({ lat: null, lng: null });
  }
}
