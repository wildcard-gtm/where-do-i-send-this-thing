import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";

// City name → approximate [x%, y%] position on a standard world map projection
// Values are percentages of image width/height for the war room map area
const CITY_COORDS: Record<string, [number, number]> = {
  "New York": [26, 38],
  "New York City": [26, 38],
  NYC: [26, 38],
  "Los Angeles": [16, 40],
  LA: [16, 40],
  "San Francisco": [14, 37],
  SF: [14, 37],
  Chicago: [23, 34],
  Boston: [27, 34],
  Austin: [21, 43],
  Seattle: [15, 30],
  Denver: [19, 37],
  Miami: [25, 46],
  Atlanta: [24, 43],
  London: [46, 29],
  Amsterdam: [48, 27],
  Berlin: [50, 27],
  Paris: [47, 30],
  Dublin: [44, 27],
  Zurich: [49, 30],
  Singapore: [74, 56],
  Sydney: [82, 70],
  Tokyo: [82, 36],
  Toronto: [25, 32],
  Vancouver: [14, 30],
  "Tel Aviv": [56, 38],
  Dubai: [60, 42],
  Munich: [50, 29],
  Stockholm: [50, 23],
  Remote: [50, 50],
  Worldwide: [50, 50],
};

function getCityCoords(city: string): [number, number] | null {
  // Exact match first
  if (CITY_COORDS[city]) return CITY_COORDS[city];
  // Partial match
  for (const [key, coords] of Object.entries(CITY_COORDS)) {
    if (city.toLowerCase().includes(key.toLowerCase())) return coords;
  }
  return null;
}

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
  companyValues: string[] | null;
  companyMission: string | null;
  officeLocations: string[] | null;
  contactName: string;
  contactTitle: string | null;
  contactPhoto: string | null;
  deliveryAddress: string | null;
}

// ─── War Room Template ────────────────────────────────────

function WarRoomTemplate({ data }: { data: PostcardData }) {
  const roles = (data.openRoles ?? []).slice(0, 3);
  const locations = (data.officeLocations ?? []).slice(0, 6);

  // Map overlay area: occupies roughly the center-left 60% of the background
  // These are % positions within the full 1536x1024 canvas
  const MAP_LEFT = 8; // % from left
  const MAP_TOP = 12; // % from top
  const MAP_WIDTH = 60; // % width
  const MAP_HEIGHT = 65; // % height

  return (
    <div
      style={{
        position: "relative",
        width: 1536,
        height: 1024,
        overflow: "hidden",
        fontFamily: "'Manrope', 'Inter', sans-serif",
      }}
    >
      {/* Background image */}
      {data.backgroundUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={data.backgroundUrl}
          alt=""
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      )}

      {/* Dark overlay for readability */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "linear-gradient(135deg, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.02) 100%)",
        }}
      />

      {/* IT'S GO TIME banner */}
      <div
        style={{
          position: "absolute",
          top: "7%",
          left: "50%",
          transform: "translateX(-50%)",
          background: "#F5EDD8",
          border: "3px solid #3C251E",
          borderRadius: 4,
          padding: "10px 48px",
          zIndex: 10,
        }}
      >
        <span
          style={{
            fontFamily: "'Manrope', sans-serif",
            fontWeight: 800,
            fontSize: 32,
            color: "#3C251E",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}
        >
          IT&apos;S GO TIME
        </span>
      </div>

      {/* Company logo — top left wall area */}
      {data.companyLogo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={data.companyLogo}
          alt="Company logo"
          style={{
            position: "absolute",
            top: "6%",
            left: "3%",
            maxHeight: 60,
            maxWidth: 160,
            objectFit: "contain",
            zIndex: 10,
            filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.4))",
          }}
        />
      )}

      {/* Map pins overlay — positioned over the map area */}
      {locations.map((city, i) => {
        const coords = getCityCoords(city);
        if (!coords) return null;
        const [xPct, yPct] = coords;
        // Convert map-relative % to canvas absolute %
        const canvasX = MAP_LEFT + (xPct / 100) * MAP_WIDTH;
        const canvasY = MAP_TOP + (yPct / 100) * MAP_HEIGHT;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${canvasX}%`,
              top: `${canvasY}%`,
              transform: "translate(-50%, -100%)",
              zIndex: 15,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            {/* Pin */}
            <div
              style={{
                width: 16,
                height: 16,
                borderRadius: "50% 50% 50% 0",
                background: "#C0392B",
                border: "2px solid #F5EDD8",
                transform: "rotate(-45deg)",
                boxShadow: "0 2px 4px rgba(0,0,0,0.5)",
              }}
            />
            {/* City label */}
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
                whiteSpace: "nowrap",
                fontFamily: "'Manrope', sans-serif",
              }}
            >
              {city.split(",")[0].trim()}
            </div>
          </div>
        );
      })}

      {/* Side panel — open roles (right side) */}
      <div
        style={{
          position: "absolute",
          top: "20%",
          right: "2%",
          width: "24%",
          zIndex: 10,
        }}
      >
        {/* Circular "HERE" / hiring badge */}
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
            marginLeft: "auto",
            marginRight: "auto",
          }}
        >
          <span
            style={{
              fontFamily: "'Manrope', sans-serif",
              fontWeight: 800,
              fontSize: 18,
              color: "#F5EDD8",
              letterSpacing: "0.06em",
            }}
          >
            HIRING
          </span>
        </div>

        {/* Role list */}
        <div
          style={{
            background: "rgba(245,237,216,0.88)",
            border: "2px solid #3C251E",
            borderRadius: 6,
            padding: "12px 14px",
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
                }}
              >
                <div
                  style={{
                    fontFamily: "'Manrope', sans-serif",
                    fontWeight: 700,
                    fontSize: 13,
                    color: "#3C251E",
                    lineHeight: 1.3,
                  }}
                >
                  {role.title}
                </div>
                {role.location && (
                  <div
                    style={{
                      fontFamily: "'Manrope', sans-serif",
                      fontWeight: 400,
                      fontSize: 11,
                      color: "#7A5C4F",
                      marginTop: 2,
                    }}
                  >
                    {role.location}
                  </div>
                )}
              </div>
            ))
          ) : (
            <div
              style={{
                fontFamily: "'Manrope', sans-serif",
                fontWeight: 600,
                fontSize: 13,
                color: "#7A5C4F",
              }}
            >
              Open roles available
            </div>
          )}
        </div>
      </div>

      {/* Contact photo + name — bottom left */}
      <div
        style={{
          position: "absolute",
          bottom: "6%",
          left: "3%",
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        {data.contactPhoto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={data.contactPhoto}
            alt={data.contactName}
            style={{
              width: 72,
              height: 72,
              borderRadius: "50%",
              objectFit: "cover",
              border: "3px solid #F5EDD8",
              boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
            }}
          />
        ) : (
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: "50%",
              background: "#7FB5A0",
              border: "3px solid #F5EDD8",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 28,
              fontWeight: 800,
              color: "#F5EDD8",
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
          }}
        >
          <div
            style={{
              fontFamily: "'Manrope', sans-serif",
              fontWeight: 700,
              fontSize: 15,
              color: "#3C251E",
            }}
          >
            {data.contactName}
          </div>
          {data.contactTitle && (
            <div
              style={{
                fontFamily: "'Manrope', sans-serif",
                fontWeight: 400,
                fontSize: 12,
                color: "#7A5C4F",
                marginTop: 2,
              }}
            >
              {data.contactTitle}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Zoom Room Template ───────────────────────────────────

function ZoomRoomTemplate({ data }: { data: PostcardData }) {
  const roles = (data.openRoles ?? []).slice(0, 3);

  return (
    <div
      style={{
        position: "relative",
        width: 1536,
        height: 1024,
        overflow: "hidden",
        fontFamily: "'Manrope', 'Inter', sans-serif",
        background: "#1C1C1C",
      }}
    >
      {/* Background image */}
      {data.backgroundUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={data.backgroundUrl}
          alt=""
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      )}

      {/* Top bar: meeting title */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 52,
          background: "rgba(28,28,28,0.92)",
          borderBottom: "1px solid #444",
          display: "flex",
          alignItems: "center",
          paddingLeft: 20,
          zIndex: 20,
        }}
      >
        <span
          style={{
            fontFamily: "'Manrope', sans-serif",
            fontWeight: 600,
            fontSize: 15,
            color: "#FFFFFF",
          }}
        >
          {data.contactName}&apos;s Company — Hiring Sprint
        </span>
      </div>

      {/* Presentation slide overlay — left side */}
      <div
        style={{
          position: "absolute",
          top: 52,
          left: 0,
          width: "66%",
          bottom: 56,
          background: "rgba(255,255,255,0.94)",
          zIndex: 10,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "32px 48px",
          gap: 20,
        }}
      >
        {/* Company logo */}
        {data.companyLogo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={data.companyLogo}
            alt="Company logo"
            style={{ maxHeight: 80, maxWidth: 280, objectFit: "contain" }}
          />
        ) : (
          <div
            style={{
              fontFamily: "'Manrope', sans-serif",
              fontWeight: 800,
              fontSize: 28,
              color: "#1a1a1a",
            }}
          >
            {data.contactTitle?.split(" ").slice(-1)[0] ?? "Company"}
          </div>
        )}

        {/* It's Go Time */}
        <div
          style={{
            fontFamily: "'Manrope', sans-serif",
            fontWeight: 800,
            fontSize: 42,
            color: "#1a1a1a",
            textAlign: "center",
            lineHeight: 1.1,
          }}
        >
          It&apos;s Go Time
        </div>

        {/* Mission */}
        {data.companyMission && (
          <div
            style={{
              fontFamily: "'Manrope', sans-serif",
              fontWeight: 400,
              fontSize: 16,
              color: "#555",
              textAlign: "center",
              maxWidth: 540,
              lineHeight: 1.5,
            }}
          >
            {data.companyMission}
          </div>
        )}

        {/* Open roles */}
        {roles.length > 0 && (
          <div style={{ width: "100%", maxWidth: 480 }}>
            <div
              style={{
                fontFamily: "'Manrope', sans-serif",
                fontWeight: 700,
                fontSize: 14,
                color: "#1a1a1a",
                marginBottom: 10,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Open Roles
            </div>
            {roles.map((role, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 6,
                }}
              >
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "#1a1a1a",
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontFamily: "'Manrope', sans-serif",
                    fontWeight: 500,
                    fontSize: 15,
                    color: "#333",
                  }}
                >
                  {role.title}
                  {role.location && (
                    <span style={{ color: "#888", fontWeight: 400 }}>
                      {" "}— {role.location}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Gallery tiles — right side, 2x2 grid */}
      <div
        style={{
          position: "absolute",
          top: 52,
          right: 0,
          width: "34%",
          bottom: 56,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gridTemplateRows: "1fr 1fr",
          gap: 3,
          background: "#1C1C1C",
          zIndex: 10,
        }}
      >
        {/* Tile 1 — placeholder */}
        <div
          style={{
            background: "#2A2A2A",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: "50%",
              background: "#444",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 24,
              color: "#888",
            }}
          >
            👤
          </div>
        </div>

        {/* Tile 2 — contact photo */}
        <div
          style={{
            background: "#2A2A2A",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            paddingBottom: 12,
            position: "relative",
            overflow: "hidden",
          }}
        >
          {data.contactPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.contactPhoto}
              alt={data.contactName}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
              }}
            />
          ) : (
            <div
              style={{
                width: 60,
                height: 60,
                borderRadius: "50%",
                background: "#7FB5A0",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 24,
                fontWeight: 800,
                color: "#fff",
              }}
            >
              {data.contactName.charAt(0).toUpperCase()}
            </div>
          )}
          {/* Name label */}
          <div
            style={{
              position: "absolute",
              bottom: 8,
              left: 0,
              right: 0,
              textAlign: "center",
              background: "rgba(0,0,0,0.6)",
              padding: "4px 8px",
              fontSize: 11,
              fontWeight: 600,
              color: "#fff",
              fontFamily: "'Manrope', sans-serif",
            }}
          >
            {data.contactName}
          </div>
        </div>

        {/* Tile 3 — placeholder */}
        <div
          style={{
            background: "#252525",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: "50%",
              background: "#444",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 24,
              color: "#888",
            }}
          >
            👤
          </div>
        </div>

        {/* Tile 4 — placeholder */}
        <div
          style={{
            background: "#2D2D2D",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: "50%",
              background: "#444",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 24,
              color: "#888",
            }}
          >
            👤
          </div>
        </div>
      </div>

      {/* Bottom control bar */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 56,
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
          <div
            key={label}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 3,
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                background: "#3A3A3A",
                border: "1px solid #555",
              }}
            />
            <span
              style={{
                fontFamily: "'Manrope', sans-serif",
                fontSize: 10,
                color: "#AAA",
              }}
            >
              {label}
            </span>
          </div>
        ))}
        {/* Leave button */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 3,
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: "#E02020",
              border: "1px solid #FF4444",
            }}
          />
          <span
            style={{
              fontFamily: "'Manrope', sans-serif",
              fontSize: 10,
              color: "#FF6666",
            }}
          >
            Leave
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────

export default async function PostcardRenderPage({
  params,
}: {
  params: Promise<{ postcardId: string }>;
}) {
  const { postcardId } = await params;

  const postcard = await prisma.postcard.findUnique({
    where: { id: postcardId },
  });

  if (!postcard) {
    notFound();
  }

  const data: PostcardData = {
    id: postcard.id,
    template: postcard.template,
    backgroundUrl: postcard.backgroundUrl,
    companyLogo: postcard.companyLogo,
    openRoles: postcard.openRoles as OpenRole[] | null,
    companyValues: postcard.companyValues as string[] | null,
    companyMission: postcard.companyMission,
    officeLocations: postcard.officeLocations as string[] | null,
    contactName: postcard.contactName,
    contactTitle: postcard.contactTitle,
    contactPhoto: postcard.contactPhoto,
    deliveryAddress: postcard.deliveryAddress,
  };

  if (data.template === "zoom") {
    return <ZoomRoomTemplate data={data} />;
  }

  return <WarRoomTemplate data={data} />;
}
