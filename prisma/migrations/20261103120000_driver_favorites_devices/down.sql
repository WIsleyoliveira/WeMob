DROP TABLE IF EXISTS "public"."DriverFavoriteStation";
ALTER TABLE "public"."DriverSession" DROP COLUMN IF EXISTS "lastSeenAt";
ALTER TABLE "public"."DriverSession" DROP COLUMN IF EXISTS "deviceLabel";
