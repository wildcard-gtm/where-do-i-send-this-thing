import { getSession } from "@/lib/auth";
import { uploadReferenceImage } from "@/lib/supabase-storage";
import crypto from "crypto";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp"];

// POST /api/uploads/image — upload a standalone image and get back a public URL
// Used by the regeneration modal to upload prospect/team/logo photos
export async function POST(request: Request) {
  const user = await getSession();
  if (!user) {
    return new Response("Not authenticated", { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return Response.json({ error: "Missing file" }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return Response.json(
      { error: "Invalid file type. Use PNG, JPEG, or WebP." },
      { status: 400 }
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    return Response.json({ error: "File too large. Maximum 10MB." }, { status: 400 });
  }

  const fileId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const ext =
    file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const storagePath = `uploads/${user.id}/${fileId}.${ext}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const url = await uploadReferenceImage(buffer, storagePath, file.type);

  return Response.json({ url });
}
