-- Photos can live in private file storage (Vercel Blob) instead of the database. Additive only.
ALTER TABLE "Listing" ADD COLUMN "photoUrl" TEXT;
ALTER TABLE "OrderEvidence" ADD COLUMN "photoUrl" TEXT;
