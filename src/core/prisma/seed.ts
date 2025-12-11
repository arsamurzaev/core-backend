// import { Prisma } from '@/src/generated/prisma/client';

// const users: User = [

// ];

// async function main() {
//   console.log(`Start seeding ...`);

//   // Clear existing data
//   await prisma.post.deleteMany();
//   await prisma.user.deleteMany();

//   for (const u of users) {
//     const user = await prisma.user.create({
//       data: u,
//     });
//     console.log(`Created user with id: ${user.id}`);
//   }
//   console.log(`Seeding finished.`);
// }

// main()
//   .then(async () => {
//     await prisma.$disconnect();
//   })
//   .catch(async (e) => {
//     console.error(e);
//     await prisma.$disconnect();
//     process.exit(1);
//   });
