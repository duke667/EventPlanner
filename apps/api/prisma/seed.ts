import * as argon2 from "argon2";
import { PrismaClient, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
  const passwordHash = await argon2.hash(password);

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      firstName: "Admin",
      lastName: "User",
      passwordHash,
      role: UserRole.ADMIN,
    },
    create: {
      email,
      firstName: "Admin",
      lastName: "User",
      passwordHash,
      role: UserRole.ADMIN,
    },
  });

  console.log(
    `Seeded admin user ${user.email} with password ${password}. Change this immediately outside local development.`,
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
