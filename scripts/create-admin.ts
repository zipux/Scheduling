// Creates (or promotes) a platform admin. Usage:
//   npm run admin:create -- admin@yourdomain.com "Your Name"
// No password is set: the admin signs in with an email link (Spec §4 — no passwords are shared).
import "dotenv/config";
import { rawDb as db } from "../src/server/db/client";

const [email, name] = process.argv.slice(2);
if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) {
  console.error('Usage: npm run admin:create -- <email> "<name>"');
  process.exit(1);
}

async function main() {
  const user = await db.user.upsert({
    where: { email: email.toLowerCase() },
    update: { isPlatformAdmin: true },
    create: { email: email.toLowerCase(), name: name || email, emailVerified: true, isPlatformAdmin: true },
  });
  console.log(`${user.email} is a platform admin. Sign in at /sign-in with "Email me a sign-in link".`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
