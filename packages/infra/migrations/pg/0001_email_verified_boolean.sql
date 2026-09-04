ALTER TABLE "user" ALTER COLUMN "emailVerified" DROP DEFAULT;
ALTER TABLE "user" ALTER COLUMN "emailVerified" TYPE boolean USING (("emailVerified")::int <> 0);
ALTER TABLE "user" ALTER COLUMN "emailVerified" SET DEFAULT false;
ALTER TABLE "user" ALTER COLUMN "emailVerified" SET NOT NULL;
