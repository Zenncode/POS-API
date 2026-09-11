# Database

This backend uses Express.js and MongoDB.

Prisma schema:
- `prisma/schema.prisma` is configured for MongoDB (`provider = "mongodb"`).
- It uses `MONGODB_URI` from `.env`.
- `Admin` includes `refreshTokenHash` for refresh-token rotation and logout invalidation.

