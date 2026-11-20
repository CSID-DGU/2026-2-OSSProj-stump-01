// 시민이 올리는 사진(활동 기록·이상 신고). multer 로 multipart/form-data 를 받아 uploadDir()에 파일로 저장한다.
// 파일 이름은 무작위(UUID)라 올린 사람의 원래 파일 이름이 남지 않는다. 화면은 /uploads/<파일이름> 으로 내려받는다.
// 배포할 때 외부 저장소로 바꾸면 이 파일과 app.ts 의 /uploads 만 고친다.
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import type { Request } from 'express';
import multer from 'multer';
import { uploadDir } from './config.js';
import { badRequest } from './errors.js';

// ── 기준값 ──
export const MAX_PHOTOS = 3; // 기록 하나에 올리는 사진 수 (시민 웹 MAX_PHOTOS 와 같다)
const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 사진 한 장 10MB
export const UPLOADS_URL_PREFIX = '/uploads';

// 받는 사진 형식 → 저장할 확장자
const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
};

/** "photos" 칸으로 사진을 MAX_PHOTOS 장까지 받는 미들웨어. 넘치거나 이미지가 아니면 400. */
export function photoUpload() {
  const dir = uploadDir();
  mkdirSync(dir, { recursive: true });
  return multer({
    storage: multer.diskStorage({
      destination: dir,
      filename: (_req, file, cb) => cb(null, `${randomUUID()}${IMAGE_TYPES[file.mimetype]}`),
    }),
    limits: { files: MAX_PHOTOS, fileSize: MAX_PHOTO_BYTES },
    fileFilter: (_req, file, cb) => {
      if (IMAGE_TYPES[file.mimetype]) cb(null, true);
      else cb(badRequest('사진은 jpg·png·webp·heic 만 올릴 수 있다.'));
    },
  }).array('photos', MAX_PHOTOS);
}

/** 이 요청에서 저장한 사진 파일들 */
export function uploadedFiles(req: Request): Express.Multer.File[] {
  return Array.isArray(req.files) ? req.files : [];
}

export const photoUrl = (file: Express.Multer.File) => `${UPLOADS_URL_PREFIX}/${file.filename}`;

/** 요청이 실패했을 때 이미 저장한 사진을 지운다(남은 파일이 쌓이지 않게). */
export async function removeUploadedFiles(req: Request): Promise<void> {
  await Promise.all(uploadedFiles(req).map((f) => unlink(f.path).catch(() => undefined)));
}
