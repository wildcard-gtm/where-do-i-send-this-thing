import { ImageResponse } from "next/og";
import { prisma } from "@/lib/db";
import { NextRequest } from "next/server";

export const runtime = "nodejs";

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
  postcardHeadline: string | null;
  postcardDescription: string | null;
  accentColor: string | null;
}

function PostcardTemplate({ data }: { data: PostcardData }) {
  const accent = data.accentColor ?? "#1E3A5F";
  const roles = (data.openRoles ?? []).slice(0, 4);

  const headline = data.postcardHeadline ?? "The right hire changes everything";
  const description =
    data.postcardDescription ?? "We source the exact talent you need, fast. Let's talk.";

  // Split headline: first half on line 1, remainder on line 2
  const words = headline.split(" ");
  const mid = Math.ceil(words.length / 2);
  const line1 = words.slice(0, mid).join(" ");
  const line2 = words.slice(mid).join(" ");

  const PHOTO_PCT = 40;

  return (
    <div
      style={{
        display: "flex",
        position: "relative",
        width: W,
        height: H,
        overflow: "hidden",
        background: "#FFFFFF",
        fontFamily: "'Helvetica Neue', Arial, sans-serif",
      }}
    >
      {/* ── Left: AI photo ── */}
      {data.backgroundUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={data.backgroundUrl}
          alt=""
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: `${PHOTO_PCT + 6}%`,
            height: "100%",
            objectFit: "cover",
            objectPosition: "center top",
          }}
        />
      )}

      {/* Fade from photo into white */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: `${PHOTO_PCT - 4}%`,
          width: "16%",
          height: "100%",
          background:
            "linear-gradient(to right, transparent 0%, rgba(255,255,255,0.5) 30%, rgba(255,255,255,0.88) 60%, #ffffff 100%)",
          display: "flex",
        }}
      />

      {/* ── Right: white content ── */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: `${PHOTO_PCT + 8}%`,
          right: 0,
          bottom: 0,
          display: "flex",
          flexDirection: "column",
          padding: "48px 56px 44px 24px",
          background: "#FFFFFF",
        }}
      >
        {/* Logo — top right */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 28 }}>
          {data.companyLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.companyLogo}
              alt="Logo"
              style={{
                maxHeight: 44,
                maxWidth: 180,
                objectFit: "contain",
                objectPosition: "right center",
              }}
            />
          ) : (
            <div style={{ height: 44, display: "flex" }} />
          )}
        </div>

        {/* Decorative × top-left */}
        <div
          style={{
            position: "absolute",
            top: 56,
            left: 16,
            fontSize: 32,
            fontWeight: 900,
            color: accent,
            opacity: 0.25,
            display: "flex",
            lineHeight: 1,
          }}
        >
          ×
        </div>

        {/* Headline — large */}
        <div style={{ display: "flex", flexDirection: "column", marginBottom: 22 }}>
          <span
            style={{
              fontWeight: 800,
              fontSize: 72,
              lineHeight: 1.05,
              color: accent,
              letterSpacing: "-0.03em",
              display: "flex",
            }}
          >
            {line1}
          </span>
          {line2 && (
            <span
              style={{
                fontWeight: 800,
                fontSize: 72,
                lineHeight: 1.05,
                color: accent,
                letterSpacing: "-0.03em",
                display: "flex",
              }}
            >
              {line2}
            </span>
          )}
        </div>

        {/* Description */}
        <div
          style={{
            fontSize: 18,
            lineHeight: 1.6,
            color: "#555555",
            marginBottom: 36,
            maxWidth: 500,
            display: "flex",
          }}
        >
          {description}
        </div>

        {/* Role list — "We Source" label */}
        {roles.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", marginBottom: 0 }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: accent,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                marginBottom: 14,
                display: "flex",
              }}
            >
              We Source
            </span>
            {roles.map((role, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  marginBottom: i < roles.length - 1 ? 12 : 0,
                }}
              >
                <div
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 4,
                    background: accent,
                    flexShrink: 0,
                    display: "flex",
                  }}
                />
                <span
                  style={{
                    fontWeight: 600,
                    fontSize: 16,
                    color: "#1a1a1a",
                    display: "flex",
                  }}
                >
                  {role.title}
                </span>
                {role.location && (
                  <span
                    style={{
                      fontSize: 13,
                      color: "#999999",
                      display: "flex",
                    }}
                  >
                    · {role.location}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        <div style={{ flex: 1, display: "flex" }} />

        {/* Decorative × bottom-right */}
        <div
          style={{
            position: "absolute",
            bottom: 100,
            right: 56,
            fontSize: 32,
            fontWeight: 900,
            color: accent,
            opacity: 0.25,
            display: "flex",
            lineHeight: 1,
          }}
        >
          ×
        </div>

        {/* Bottom: contact + CTA */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: `1.5px solid ${accent}22`,
            paddingTop: 20,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {data.contactPhoto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={data.contactPhoto}
                alt={data.contactName}
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 26,
                  objectFit: "cover",
                  border: `2px solid ${accent}44`,
                  flexShrink: 0,
                }}
              />
            ) : (
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 26,
                  background: accent,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  fontSize: 22,
                  color: "#FFFFFF",
                  flexShrink: 0,
                }}
              >
                {data.contactName.charAt(0).toUpperCase()}
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span
                style={{
                  fontWeight: 700,
                  fontSize: 16,
                  color: "#111111",
                  display: "flex",
                  lineHeight: 1.2,
                }}
              >
                {data.contactName}
              </span>
              {data.contactTitle && (
                <span
                  style={{
                    fontSize: 13,
                    color: "#888888",
                    marginTop: 3,
                    display: "flex",
                  }}
                >
                  {data.contactTitle}
                </span>
              )}
            </div>
          </div>

          {/* CTA pill */}
          <div
            style={{
              background: accent,
              borderRadius: 999,
              padding: "13px 30px",
              display: "flex",
              alignItems: "center",
            }}
          >
            <span
              style={{
                color: "#FFFFFF",
                fontWeight: 700,
                fontSize: 15,
                display: "flex",
                letterSpacing: "0.01em",
              }}
            >
              Let&apos;s talk →
            </span>
          </div>
        </div>
      </div>

      {/* Thin accent stripe — left edge */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: 7,
          height: "100%",
          background: accent,
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

  const p = postcard as Record<string, unknown>;

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
    backMessage: p.backMessage as string | null ?? null,
    postcardHeadline: p.postcardHeadline as string | null ?? null,
    postcardDescription: p.postcardDescription as string | null ?? null,
    accentColor: p.accentColor as string | null ?? null,
  };

  return new ImageResponse(
    <PostcardTemplate data={data} />,
    { width: W, height: H }
  );
}
