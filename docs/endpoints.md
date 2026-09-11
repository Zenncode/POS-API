# Endpoints

## Auth

- `POST /api/auth/admin/login`
- `POST /api/auth/admin/refresh`
- `POST /api/auth/admin/logout` (requires admin access token)

## Protected

- `GET /api/admin/me`

Notes:
- This login route is public.
- Refresh route is public but requires a valid refresh token in request body.
- Logout route requires a valid admin access token.
- `/api/admin/me` requires a valid admin JWT token.

