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
  backMessage: string | null;
}

// ─── WAR ROOM (office / hybrid contacts) ─────────────────────────────────────
// Layout inspired by bold conference branding:
//   Left ~62%: full-bleed background photo
//   Right ~38%: dark accent panel with logo, headline, roles, contact info

function WarRoomPostcard({ data }: { data: PostcardData }) {
  const roles = (data.openRoles ?? []).slice(0, 4);
  const PANEL_LEFT = 62; // percent where the right panel starts

  return (
    <div
      style={{
        display: "flex",
        position: "relative",
        width: W,
        height: H,
        overflow: "hidden",
        fontFamily: "'Helvetica Neue', Arial, sans-serif",
        background: "#0F1923",
      }}
    >
      {/* ── Left: full-bleed background photo ── */}
      {data.backgroundUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={data.backgroundUrl}
          alt=""
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: `${PANEL_LEFT + 4}%`,
            height: "100%",
            objectFit: "cover",
            objectPosition: "center",
          }}
        />
      )}

      {/* Gradient fade on left photo edge into panel */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: `${PANEL_LEFT - 8}%`,
          width: "12%",
          height: "100%",
          background: "linear-gradient(to right, transparent, #0F1923)",
          display: "flex",
          zIndex: 5,
        }}
      />

      {/* ── Right: dark panel ── */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: `${PANEL_LEFT}%`,
          right: 0,
          bottom: 0,
          background: "#0F1923",
          display: "flex",
          flexDirection: "column",
          padding: "40px 44px",
          zIndex: 10,
        }}
      >
        {/* Company logo */}
        {data.companyLogo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={data.companyLogo}
            alt="Logo"
            style={{
              maxHeight: 44,
              maxWidth: 180,
              objectFit: "contain",
              objectPosition: "left center",
              marginBottom: 28,
              filter: "brightness(0) invert(1)",
              opacity: 0.9,
            }}
          />
        ) : (
          <div style={{ height: 44, marginBottom: 28, display: "flex" }} />
        )}

        {/* Headline */}
        <div
          style={{
            fontWeight: 900,
            fontSize: 52,
            lineHeight: 1.05,
            color: "#FFFFFF",
            letterSpacing: "-0.02em",
            marginBottom: 8,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <span>IT&apos;S</span>
          <span style={{ color: "#E63329" }}>GO TIME.</span>
        </div>

        {/* Thin red rule */}
        <div
          style={{
            width: 48,
            height: 3,
            background: "#E63329",
            marginBottom: 24,
            display: "flex",
          }}
        />

        {/* Open roles */}
        {roles.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", marginBottom: 24 }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "#E63329",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                marginBottom: 10,
                display: "flex",
              }}
            >
              Now Hiring
            </span>
            {roles.map((role, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  borderLeft: "2px solid rgba(230,51,41,0.35)",
                  paddingLeft: 12,
                  marginBottom: i < roles.length - 1 ? 10 : 0,
                }}
              >
                <span
                  style={{
                    fontWeight: 700,
                    fontSize: 14,
                    color: "#FFFFFF",
                    lineHeight: 1.25,
                    display: "flex",
                  }}
                >
                  {role.title}
                </span>
                {role.location && (
                  <span
                    style={{
                      fontWeight: 400,
                      fontSize: 11,
                      color: "rgba(255,255,255,0.5)",
                      marginTop: 2,
                      display: "flex",
                    }}
                  >
                    {role.location}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Spacer */}
        <div style={{ flex: 1, display: "flex" }} />

        {/* Contact card at bottom */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            borderTop: "1px solid rgba(255,255,255,0.12)",
            paddingTop: 20,
          }}
        >
          {/* Contact photo */}
          {data.contactPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.contactPhoto}
              alt={data.contactName}
              style={{
                width: 64,
                height: 64,
                borderRadius: "50%",
                objectFit: "cover",
                border: "2px solid rgba(230,51,41,0.6)",
                flexShrink: 0,
              }}
            />
          ) : (
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: "50%",
                background: "#E63329",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 800,
                fontSize: 26,
                color: "#FFFFFF",
                flexShrink: 0,
                border: "2px solid rgba(230,51,41,0.6)",
              }}
            >
              {data.contactName.charAt(0).toUpperCase()}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span
              style={{
                fontWeight: 700,
                fontSize: 16,
                color: "#FFFFFF",
                display: "flex",
                lineHeight: 1.2,
              }}
            >
              {data.contactName}
            </span>
            {data.contactTitle && (
              <span
                style={{
                  fontWeight: 400,
                  fontSize: 12,
                  color: "rgba(255,255,255,0.55)",
                  marginTop: 3,
                  display: "flex",
                }}
              >
                {data.contactTitle}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Top-left: diagonal red accent stripe ── */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: 8,
          height: "100%",
          background: "#E63329",
          display: "flex",
          zIndex: 20,
        }}
      />
    </div>
  );
}

// ─── ZOOM ROOM (fully remote contacts) ────────────────────────────────────────
// Layout: same panel concept but navy/teal color scheme

function ZoomRoomPostcard({ data }: { data: PostcardData }) {
  const roles = (data.openRoles ?? []).slice(0, 4);
  const PANEL_LEFT = 62;

  return (
    <div
      style={{
        display: "flex",
        position: "relative",
        width: W,
        height: H,
        overflow: "hidden",
        fontFamily: "'Helvetica Neue', Arial, sans-serif",
        background: "#0D1B2A",
      }}
    >
      {/* Left: background photo */}
      {data.backgroundUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={data.backgroundUrl}
          alt=""
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: `${PANEL_LEFT + 4}%`,
            height: "100%",
            objectFit: "cover",
            objectPosition: "center",
          }}
        />
      )}

      {/* Gradient fade */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: `${PANEL_LEFT - 8}%`,
          width: "12%",
          height: "100%",
          background: "linear-gradient(to right, transparent, #0D1B2A)",
          display: "flex",
          zIndex: 5,
        }}
      />

      {/* Right panel — navy */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: `${PANEL_LEFT}%`,
          right: 0,
          bottom: 0,
          background: "#0D1B2A",
          display: "flex",
          flexDirection: "column",
          padding: "40px 44px",
          zIndex: 10,
        }}
      >
        {data.companyLogo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={data.companyLogo}
            alt="Logo"
            style={{
              maxHeight: 44,
              maxWidth: 180,
              objectFit: "contain",
              objectPosition: "left center",
              marginBottom: 28,
              filter: "brightness(0) invert(1)",
              opacity: 0.9,
            }}
          />
        ) : (
          <div style={{ height: 44, marginBottom: 28, display: "flex" }} />
        )}

        <div
          style={{
            fontWeight: 900,
            fontSize: 52,
            lineHeight: 1.05,
            color: "#FFFFFF",
            letterSpacing: "-0.02em",
            marginBottom: 8,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <span>LET&apos;S</span>
          <span style={{ color: "#2DD4BF" }}>CONNECT.</span>
        </div>

        <div
          style={{
            width: 48,
            height: 3,
            background: "#2DD4BF",
            marginBottom: 24,
            display: "flex",
          }}
        />

        {data.companyMission && (
          <div
            style={{
              fontSize: 13,
              color: "rgba(255,255,255,0.65)",
              lineHeight: 1.55,
              marginBottom: 20,
              display: "flex",
              fontStyle: "italic",
            }}
          >
            &ldquo;{data.companyMission}&rdquo;
          </div>
        )}

        {roles.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", marginBottom: 24 }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: "#2DD4BF",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                marginBottom: 10,
                display: "flex",
              }}
            >
              Open Roles
            </span>
            {roles.map((role, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  borderLeft: "2px solid rgba(45,212,191,0.35)",
                  paddingLeft: 12,
                  marginBottom: i < roles.length - 1 ? 10 : 0,
                }}
              >
                <span style={{ fontWeight: 700, fontSize: 14, color: "#FFFFFF", display: "flex" }}>
                  {role.title}
                </span>
                {role.location && (
                  <span style={{ fontWeight: 400, fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 2, display: "flex" }}>
                    {role.location}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        <div style={{ flex: 1, display: "flex" }} />

        {/* Contact card */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            borderTop: "1px solid rgba(255,255,255,0.12)",
            paddingTop: 20,
          }}
        >
          {data.contactPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.contactPhoto}
              alt={data.contactName}
              style={{
                width: 64,
                height: 64,
                borderRadius: "50%",
                objectFit: "cover",
                border: "2px solid rgba(45,212,191,0.6)",
                flexShrink: 0,
              }}
            />
          ) : (
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: "50%",
                background: "#2DD4BF",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 800,
                fontSize: 26,
                color: "#0D1B2A",
                flexShrink: 0,
                border: "2px solid rgba(45,212,191,0.6)",
              }}
            >
              {data.contactName.charAt(0).toUpperCase()}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <span style={{ fontWeight: 700, fontSize: 16, color: "#FFFFFF", display: "flex", lineHeight: 1.2 }}>
              {data.contactName}
            </span>
            {data.contactTitle && (
              <span style={{ fontWeight: 400, fontSize: 12, color: "rgba(255,255,255,0.55)", marginTop: 3, display: "flex" }}>
                {data.contactTitle}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Left accent stripe — teal */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: 8,
          height: "100%",
          background: "#2DD4BF",
          display: "flex",
          zIndex: 20,
        }}
      />
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
    backMessage: (postcard as Record<string, unknown>).backMessage as string | null ?? null,
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
