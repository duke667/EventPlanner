import * as argon2 from "argon2";
import { PrismaClient, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
  const password = process.env.SEED_ADMIN_PASSWORD;
  const firstName = process.env.SEED_ADMIN_FIRST_NAME ?? "Admin";
  const lastName = process.env.SEED_ADMIN_LAST_NAME ?? "User";

  if (!password) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SEED_ADMIN_PASSWORD is required in production.");
    }
  }

  const effectivePassword = password ?? "ChangeMe123!";
  const passwordHash = await argon2.hash(effectivePassword);

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      firstName,
      lastName,
      passwordHash,
      role: UserRole.ADMIN,
    },
    create: {
      email,
      firstName,
      lastName,
      passwordHash,
      role: UserRole.ADMIN,
    },
  });

  console.log(
    `Seeded admin user ${user.email} with password ${effectivePassword}. Change this immediately outside local development.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
