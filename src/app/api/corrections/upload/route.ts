/**
 * Reference Image Upload — upload/delete reference images for postcard corrections.
 *
 * POST /api/corrections/upload — upload a reference image
 *   FormData: postcardId, file (image), label
 *   Returns: { id, url, label }
 *
 * DELETE /api/corrections/upload — remove a reference image
 *   Body: { referenceId }
 */

import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getTeamUserIds } from '@/lib/team';
import { uploadReferenceImage, deletePostcardImage, extractStoragePath } from '@/lib/supabase-storage';
import crypto from 'crypto';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

export async function POST(request: Request) {
  const user = await getSession();
  if (!user) {
    return new Response('Not authenticated', { status: 401 });
  }

  const formData = await request.formData();
  const postcardId = formData.get('postcardId') as string;
  const file = formData.get('file') as File | null;
  const label = (formData.get('label') as string) || 'reference';

  if (!postcardId || !file) {
    return Response.json({ error: 'Missing postcardId or file' }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return Response.json({ error: 'Invalid file type. Use PNG, JPEG, or WebP.' }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return Response.json({ error: 'File too large. Maximum 10MB.' }, { status: 400 });
  }

  if (!['prospect_photo', 'team_photo', 'company_logo', 'reference'].includes(label)) {
    return Response.json({ error: 'Invalid label' }, { status: 400 });
  }

  // Verify postcard ownership
  const teamUserIds = await getTeamUserIds(user);
  const postcard = await prisma.postcard.findFirst({
    where: {
      id: postcardId,
      contact: { userId: { in: teamUserIds } },
    },
    select: { id: true },
  });

  if (!postcard) {
    return Response.json({ error: 'Postcard not found' }, { status: 404 });
  }

  // Upload to Supabase Storage
  const fileId = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const storagePath = `references/${postcardId}/${fileId}.${ext}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const url = await uploadReferenceImage(buffer, storagePath, file.type);

  // Create DB record
  const ref = await prisma.postcardReference.create({
    data: {
      postcardId,
      label,
      imageUrl: url,
      storagePath,
    },
  });

  return Response.json({ id: ref.id, url: ref.imageUrl, label: ref.label });
}

export async function DELETE(request: Request) {
  const user = await getSession();
  if (!user) {
    return new Response('Not authenticated', { status: 401 });
  }

  const body = await request.json();
  const { referenceId } = body;

  if (!referenceId) {
    return Response.json({ error: 'Missing referenceId' }, { status: 400 });
  }

  const teamUserIds = await getTeamUserIds(user);

  // Verify ownership via postcard → contact → user
  const ref = await prisma.postcardReference.findFirst({
    where: {
      id: referenceId,
      postcard: {
        contact: { userId: { in: teamUserIds } },
      },
    },
  });

  if (!ref) {
    return Response.json({ error: 'Reference not found' }, { status: 404 });
  }

  // Delete from storage
  const path = extractStoragePath(ref.imageUrl) ?? ref.storagePath;
  await deletePostcardImage(path);

  // Delete DB record
  await prisma.postcardReference.delete({ where: { id: referenceId } });

  return Response.json({ success: true });
}
