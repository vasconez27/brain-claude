import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const password = await bcrypt.hash("password123", 10);

  // Manager
  const manager = await prisma.user.upsert({
    where: { email: "manager@bigcrewny.com" },
    update: {},
    create: {
      name: "Mike (Manager)",
      email: "manager@bigcrewny.com",
      phone: "+15550000001",
      passwordHash: password,
      role: "MANAGER",
    },
  });

  // Crew members
  const crewData = [
    { name: "Carlos Rivera", email: "carlos@bigcrewny.com", phone: "+15550000002" },
    { name: "Jamal Smith", email: "jamal@bigcrewny.com", phone: "+15550000003" },
    { name: "Tony Russo", email: "tony@bigcrewny.com", phone: "+15550000004" },
  ];

  const crew = [];
  for (const c of crewData) {
    const member = await prisma.user.upsert({
      where: { email: c.email },
      update: {},
      create: { ...c, passwordHash: password, role: "CREW" },
    });
    crew.push(member);
  }

  // A few shifts (only seed if none exist for this manager)
  const existing = await prisma.shift.count({ where: { managerId: manager.id } });
  if (existing === 0) {
    const day = (offset: number, hour: number) => {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      d.setHours(hour, 0, 0, 0);
      return d;
    };

    await prisma.shift.create({
      data: {
        title: "Load In — Madison Square Garden",
        location: "MSG, 4 Penn Plaza",
        description: "Stage build + rigging. Steel-toe boots required.",
        startTime: day(2, 6),
        endTime: day(2, 16),
        payRate: 32,
        status: "FILLED",
        managerId: manager.id,
        assignments: {
          create: [
            { userId: crew[0].id, status: "CONFIRMED" },
            { userId: crew[1].id, status: "PENDING" },
          ],
        },
      },
    });

    await prisma.shift.create({
      data: {
        title: "Show Call — Barclays Center",
        location: "Barclays Center, Brooklyn",
        description: "Spot ops during the show.",
        startTime: day(4, 17),
        endTime: day(4, 23),
        payRate: 28,
        status: "OPEN",
        managerId: manager.id,
        assignments: {
          create: [{ userId: crew[2].id, status: "PENDING" }],
        },
      },
    });

    await prisma.shift.create({
      data: {
        title: "Load Out — Terminal 5",
        location: "Terminal 5, 610 W 56th St",
        startTime: day(-3, 22),
        endTime: day(-2, 4),
        payRate: 35,
        status: "FILLED",
        managerId: manager.id,
        assignments: {
          create: [{ userId: crew[0].id, status: "CONFIRMED", hoursWorked: 6 }],
        },
      },
    });
  }

  console.log("Seed complete.");
  console.log("Manager login → manager@bigcrewny.com / password123");
  console.log("Crew login    → carlos@bigcrewny.com / password123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
