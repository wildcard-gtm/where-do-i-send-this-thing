import { ImageResponse } from "next/og";
import { prisma } from "@/lib/db";
import { NextRequest } from "next/server";

export const runtime = "nodejs";

// 1536x1024 postcard canvas
const W = 1536;
const H = 1024;

interface OpenRole {
  title: string;
  location: string;
  level: string;
  url?: string;
}

interface PostcardData {
  id: string;
  template: string;
  backgroundUrl: string | null;
  companyLogo: string | null;
  openRoles: OpenRole[] | null;
  companyMission: string | null;
  officeLocations: string[] | null;
  contactName: string;
  contactTitle: string | null;
  contactPhoto: string | null;
}

// City name → [x%, y%] on a world map (same as render page)
const CITY_COORDS: Record<string, [number, number]> = {
  "New York": [26, 38], "New York City": [26, 38], NYC: [26, 38],
  "Los Angeles": [16, 40], LA: [16, 40],
  "San Francisco": [14, 37], SF: [14, 37],
  Chicago: [23, 34], Boston: [27, 34], Austin: [21, 43],
  Seattle: [15, 30], Denver: [19, 37], Miami: [25, 46], Atlanta: [24, 43],
  London: [46, 29], Amsterdam: [48, 27], Berlin: [50, 27], Paris: [47, 30],
  Dublin: [44, 27], Zurich: [49, 30], Singapore: [74, 56], Sydney: [82, 70],
  Tokyo: [82, 36], Toronto: [25, 32], Vancouver: [14, 30],
  "Tel Aviv": [56, 38], Dubai: [60, 42], Munich: [50, 29], Stockholm: [50, 23],
  Remote: [50, 50], Worldwide: [50, 50],
};

function getCityCoords(city: string): [number, number] | null {
  if (CITY_COORDS[city]) return CITY_COORDS[city];
  for (const [key, coords] of Object.entries(CITY_COORDS)) {
    if (city.toLowerCase().includes(key.toLowerCase())) return coords;
  }
  return null;
}

function WarRoomPostcard({ data }: { data: PostcardData }) {
  const roles = (data.openRoles ?? []).slice(0, 3);
  const locations = (data.officeLocations ?? []).slice(0, 6);
  const MAP_LEFT = 8;
  const MAP_TOP = 12;
  const MAP_WIDTH = 60;
  const MAP_HEIGHT = 65;

  return (
    <div
      style={{
        display: "flex",
        position: "relative",
        width: W,
        height: H,
        overflow: "hidden",
        fontFamily: "sans-serif",
        background: "#2C1A0E",
      }}
    >
      {/* Background */}
      {data.backgroundUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={data.backgroundUrl}
          alt=""
          style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover" }}
        />
      )}

      {/* Overlay */}
      <div
        style={{
          position: "absolute",
          top: 0, left: 0, right: 0, bottom: 0,
          background: "linear-gradient(135deg, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.02) 100%)",
          display: "flex",
        }}
      />

      {/* IT'S GO TIME banner — centered at top */}
      <div
        style={{
          position: "absolute",
          top: "7%",
          left: "50%",
          marginLeft: -180,
          background: "#F5EDD8",
          border: "3px solid #3C251E",
          borderRadius: 4,
          padding: "10px 48px",
          display: "flex",
          zIndex: 10,
        }}
      >
        <span style={{ fontWeight: 800, fontSize: 32, color: "#3C251E", letterSpacing: "0.12em" }}>
          IT&apos;S GO TIME
        </span>
      </div>

      {/* Company logo — top left */}
      {data.companyLogo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={data.companyLogo}
          alt="Logo"
          style={{
            position: "absolute",
            top: "6%",
            left: "3%",
            maxHeight: 60,
            maxWidth: 160,
            objectFit: "contain",
            zIndex: 10,
          }}
        />
      )}

      {/* Map pins */}
      {locations.map((city, i) => {
        const coords = getCityCoords(city);
        if (!coords) return null;
        const [xPct, yPct] = coords;
        const canvasX = MAP_LEFT + (xPct / 100) * MAP_WIDTH;
        const canvasY = MAP_TOP + (yPct / 100) * MAP_HEIGHT;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${canvasX}%`,
              top: `${canvasY}%`,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              zIndex: 15,
            }}
          >
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: "#C0392B",
                border: "2px solid #F5EDD8",
                display: "flex",
              }}
            />
            <div
              style={{
                background: "rgba(245,237,216,0.92)",
                border: "1px solid #3C251E",
                borderRadius: 3,
                padding: "2px 6px",
                marginTop: 4,
                fontSize: 11,
                fontWeight: 700,
                color: "#3C251E",
                display: "flex",
              }}
            >
              {city.split(",")[0].trim()}
            </div>
          </div>
        );
      })}

      {/* Right panel — roles */}
      <div
        style={{
          position: "absolute",
          top: "20%",
          right: "2%",
          width: "24%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          zIndex: 10,
        }}
      >
        <div
          style={{
            width: 90,
            height: 90,
            borderRadius: "50%",
            background: "#7FB5A0",
            border: "3px solid #3C251E",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 12,
          }}
        >
          <span style={{ fontWeight: 800, fontSize: 18, color: "#F5EDD8", letterSpacing: "0.06em" }}>HIRING</span>
        </div>

        <div
          style={{
            background: "rgba(245,237,216,0.88)",
            border: "2px solid #3C251E",
            borderRadius: 6,
            padding: "12px 14px",
            display: "flex",
            flexDirection: "column",
            width: "100%",
          }}
        >
          {roles.length > 0 ? (
            roles.map((role, i) => (
              <div
                key={i}
                style={{
                  borderBottom: i < roles.length - 1 ? "1px solid rgba(60,37,30,0.2)" : "none",
                  paddingBottom: i < roles.length - 1 ? 8 : 0,
                  marginBottom: i < roles.length - 1 ? 8 : 0,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <span style={{ fontWeight: 700, fontSize: 13, color: "#3C251E", lineHeight: 1.3 }}>
                  {role.title}
                </span>
                {role.location && (
                  <span style={{ fontWeight: 400, fontSize: 11, color: "#7A5C4F", marginTop: 2 }}>
                    {role.location}
                  </span>
                )}
              </div>
            ))
          ) : (
            <span style={{ fontWeight: 600, fontSize: 13, color: "#7A5C4F" }}>Open roles available</span>
          )}
        </div>
      </div>

      {/* Contact — bottom left */}
      <div
        style={{
          position: "absolute",
          bottom: "6%",
          left: "3%",
          display: "flex",
          alignItems: "center",
          gap: 14,
          zIndex: 10,
        }}
      >
        {data.contactPhoto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={data.contactPhoto}
            alt={data.contactName}
            style={{ width: 72, height: 72, borderRadius: "50%", objectFit: "cover", border: "3px solid #F5EDD8" }}
          />
        ) : (
          <div
            style={{
              width: 72, height: 72, borderRadius: "50%", background: "#7FB5A0",
              border: "3px solid #F5EDD8", display: "flex", alignItems: "center",
              justifyContent: "center", fontSize: 28, fontWeight: 800, color: "#F5EDD8",
            }}
          >
            {data.contactName.charAt(0).toUpperCase()}
          </div>
        )}
        <div
          style={{
            background: "rgba(245,237,216,0.88)",
            border: "1px solid #3C251E",
            borderRadius: 6,
            padding: "6px 12px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <span style={{ fontWeight: 700, fontSize: 15, color: "#3C251E" }}>{data.contactName}</span>
          {data.contactTitle && (
            <span style={{ fontWeight: 400, fontSize: 12, color: "#7A5C4F", marginTop: 2 }}>
              {data.contactTitle}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ZoomRoomPostcard({ data }: { data: PostcardData }) {
  const roles = (data.openRoles ?? []).slice(0, 3);

  return (
    <div
      style={{
        display: "flex",
        position: "relative",
        width: W,
        height: H,
        overflow: "hidden",
        fontFamily: "sans-serif",
        background: "#1C1C1C",
      }}
    >
      {data.backgroundUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={data.backgroundUrl}
          alt=""
          style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover" }}
        />
      )}

      {/* Top bar */}
      <div
        style={{
          position: "absolute",
          top: 0, left: 0, right: 0, height: 52,
          background: "rgba(28,28,28,0.92)",
          borderBottom: "1px solid #444",
          display: "flex",
          alignItems: "center",
          paddingLeft: 20,
          zIndex: 20,
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 15, color: "#FFFFFF" }}>
          {data.contactName}&apos;s Company — Hiring Sprint
        </span>
      </div>

      {/* Left presentation panel */}
      <div
        style={{
          position: "absolute",
          top: 52, left: 0,
          width: "66%",
          bottom: 56,
          background: "rgba(255,255,255,0.94)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "32px 48px",
          zIndex: 10,
        }}
      >
        {data.companyLogo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.companyLogo} alt="Logo" style={{ maxHeight: 80, maxWidth: 280, objectFit: "contain", marginBottom: 20 }} />
        ) : (
          <div style={{ fontWeight: 800, fontSize: 28, color: "#1a1a1a", marginBottom: 20, display: "flex" }}>
            {data.contactTitle?.split(" ").slice(-1)[0] ?? "Company"}
          </div>
        )}

        <div style={{ fontWeight: 800, fontSize: 42, color: "#1a1a1a", textAlign: "center", lineHeight: 1.1, marginBottom: 20, display: "flex" }}>
          It&apos;s Go Time
        </div>

        {data.companyMission && (
          <div style={{ fontWeight: 400, fontSize: 16, color: "#555", textAlign: "center", maxWidth: 540, lineHeight: 1.5, marginBottom: 20, display: "flex" }}>
            {data.companyMission}
          </div>
        )}

        {roles.length > 0 && (
          <div style={{ width: "100%", maxWidth: 480, display: "flex", flexDirection: "column" }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: "#1a1a1a", marginBottom: 10, letterSpacing: "0.08em", display: "flex" }}>
              OPEN ROLES
            </div>
            {roles.map((role, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#1a1a1a" }} />
                <span style={{ fontWeight: 500, fontSize: 15, color: "#333", display: "flex" }}>
                  {role.title}
                  {role.location && (
                    <span style={{ color: "#888", fontWeight: 400 }}>&nbsp;— {role.location}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Right video tiles */}
      <div
        style={{
          position: "absolute",
          top: 52, right: 0,
          width: "34%",
          bottom: 56,
          display: "flex",
          flexWrap: "wrap",
          background: "#1C1C1C",
          zIndex: 10,
        }}
      >
        {/* Tile 1 placeholder */}
        <div style={{ width: "50%", height: "50%", background: "#2A2A2A", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 50, height: 50, borderRadius: "50%", background: "#444", display: "flex" }} />
        </div>

        {/* Tile 2 — contact photo */}
        <div style={{ width: "50%", height: "50%", background: "#2A2A2A", display: "flex", alignItems: "flex-end", justifyContent: "center", position: "relative", overflow: "hidden" }}>
          {data.contactPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.contactPhoto} alt={data.contactName} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <div style={{ width: 50, height: 50, borderRadius: "50%", background: "#7FB5A0", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 20, color: "#fff" }}>
              {data.contactName.charAt(0).toUpperCase()}
            </div>
          )}
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(0,0,0,0.6)", padding: "4px 8px", fontSize: 11, fontWeight: 600, color: "#fff", display: "flex", justifyContent: "center" }}>
            {data.contactName}
          </div>
        </div>

        {/* Tile 3 placeholder */}
        <div style={{ width: "50%", height: "50%", background: "#252525", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 50, height: 50, borderRadius: "50%", background: "#444", display: "flex" }} />
        </div>

        {/* Tile 4 placeholder */}
        <div style={{ width: "50%", height: "50%", background: "#2D2D2D", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 50, height: 50, borderRadius: "50%", background: "#444", display: "flex" }} />
        </div>
      </div>

      {/* Bottom bar */}
      <div
        style={{
          position: "absolute",
          bottom: 0, left: 0, right: 0, height: 56,
          background: "rgba(28,28,28,0.95)",
          borderTop: "1px solid #444",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 24,
          zIndex: 20,
        }}
      >
        {["Mute", "Video", "Share", "Chat", "Participants", "Record"].map((label) => (
          <div key={label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#3A3A3A", border: "1px solid #555", display: "flex" }} />
            <span style={{ fontSize: 10, color: "#AAA", display: "flex" }}>{label}</span>
          </div>
        ))}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
          <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#E02020", border: "1px solid #FF4444", display: "flex" }} />
          <span style={{ fontSize: 10, color: "#FF6666", display: "flex" }}>Leave</span>
        </div>
      </div>
    </div>
  );
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const postcard = await prisma.postcard.findUnique({ where: { id } });
  if (!postcard) {
    return new Response("Postcard not found", { status: 404 });
  }

  const data: PostcardData = {
    id: postcard.id,
    template: postcard.template,
    backgroundUrl: postcard.backgroundUrl,
    companyLogo: postcard.companyLogo,
    openRoles: postcard.openRoles as OpenRole[] | null,
    companyMission: postcard.companyMission,
    officeLocations: postcard.officeLocations as string[] | null,
    contactName: postcard.contactName,
    contactTitle: postcard.contactTitle,
    contactPhoto: postcard.contactPhoto,
  };

  return new ImageResponse(
    data.template === "zoom" ? (
      <ZoomRoomPostcard data={data} />
    ) : (
      <WarRoomPostcard data={data} />
    ),
    { width: W, height: H }
  );
}
